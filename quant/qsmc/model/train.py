"""Meta-label model: purged, embargoed walk-forward training.

Why walk-forward and not k-fold
-------------------------------
Financial labels overlap in time: a trade signalled at 10:00 may not exit until
14:00.  Ordinary k-fold puts overlapping samples on both sides of the split, the
model memorises the shared future, and cross-validated accuracy becomes a
fantasy.  This module therefore:

* trains only on data strictly BEFORE each test fold (expanding window);
* PURGES any training event whose label window reaches into the test fold;
* EMBARGOES a buffer of bars after the fold so serial correlation cannot
  bleed backwards.

The out-of-fold predictions produced here are the only honest estimate of live
performance in the whole pipeline.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import Config, CONFIG, ARTIFACT_DIR


@dataclass
class FoldResult:
    fold: int
    train_start: str
    train_end: str
    test_start: str
    test_end: str
    n_train: int
    n_test: int
    auc: float
    base_rate: float
    precision_at_threshold: float
    n_taken: int


def purged_walk_forward(
    labels: pd.DataFrame,
    n_splits: int = 5,
    embargo_frac: float = 0.01,
    min_train: int = 200,
):
    """Yield ``(train_positions, test_positions)`` over an event-indexed frame.

    ``labels`` must carry an ``exit_time`` column; that is what makes purging
    possible.  Positions are integer offsets into ``labels``.
    """
    n = len(labels)
    if n < min_train + n_splits:
        return

    entry = pd.to_datetime(labels["entry_time"]).to_numpy()
    exit_ = pd.to_datetime(labels["exit_time"]).to_numpy()
    order = np.argsort(entry, kind="stable")

    # Test folds carve up the tail of the sample, after the initial train block.
    first_test = max(min_train, int(n * 0.4))
    if first_test >= n - n_splits:
        first_test = max(min_train, n // 2)
    bounds = np.linspace(first_test, n, n_splits + 1).astype(int)
    embargo = max(1, int(n * embargo_frac))

    for k in range(n_splits):
        lo, hi = bounds[k], bounds[k + 1]
        if hi - lo < 5:
            continue
        test_pos = order[lo:hi]
        test_start = entry[test_pos].min()

        # Expanding train window, purged of anything still open at test_start,
        # then embargoed by dropping the last `embargo` events before the fold.
        cand = order[:lo]
        keep = exit_[cand] < test_start
        cand = cand[keep]
        if embargo and len(cand) > embargo:
            cand = cand[:-embargo]
        if len(cand) < min_train:
            continue
        yield cand, test_pos


def train_meta_model(
    features: pd.DataFrame,
    labels: pd.DataFrame,
    feature_cols: list[str],
    cfg: Config | None = None,
    verbose: bool = True,
):
    """Walk-forward train the meta-label classifier.

    Returns ``(final_model, out_of_fold_frame, fold_reports, importance)``.
    ``final_model`` is refit on everything and is what ships to live; the OOF
    frame is what you are allowed to believe.
    """
    import lightgbm as lgb
    from sklearn.metrics import roc_auc_score

    cfg = cfg or CONFIG
    mc = cfg.model

    X_all = features.reindex(labels.index)[feature_cols].astype("float64")
    y_all = labels["meta_label"].astype(int).to_numpy()

    # Weight by realised risk-adjusted magnitude: a setup that produced a large
    # move carries more information than one that scraped the barrier. Plus mild
    # recency decay, because market microstructure ages.
    mag = labels["r_multiple"].abs().clip(0.2, 3.0).to_numpy()
    recency = np.linspace(0.6, 1.0, len(labels))
    weights = mag * recency

    oof = np.full(len(labels), np.nan)
    reports: list[FoldResult] = []
    imps: list[pd.Series] = []

    for k, (tr, te) in enumerate(
        purged_walk_forward(labels, mc.n_splits, mc.embargo_frac,
                            min_train=max(120, mc.min_train_bars // 20))
    ):
        Xtr, ytr, wtr = X_all.iloc[tr], y_all[tr], weights[tr]
        Xte, yte = X_all.iloc[te], y_all[te]
        if len(np.unique(ytr)) < 2:
            continue

        model = lgb.LGBMClassifier(**mc.lgbm_params, random_state=cfg.seed)
        model.fit(Xtr, ytr, sample_weight=wtr)
        p = model.predict_proba(Xte)[:, 1]
        oof[te] = p

        try:
            auc = float(roc_auc_score(yte, p)) if len(np.unique(yte)) > 1 else float("nan")
        except ValueError:
            auc = float("nan")
        taken = p >= mc.prob_threshold
        prec = float(yte[taken].mean()) if taken.sum() else float("nan")

        reports.append(FoldResult(
            fold=k,
            train_start=str(labels["entry_time"].iloc[tr].min()),
            train_end=str(labels["exit_time"].iloc[tr].max()),
            test_start=str(labels["entry_time"].iloc[te].min()),
            test_end=str(labels["entry_time"].iloc[te].max()),
            n_train=len(tr), n_test=len(te),
            auc=round(auc, 4),
            base_rate=round(float(yte.mean()), 4),
            precision_at_threshold=round(prec, 4) if prec == prec else float("nan"),
            n_taken=int(taken.sum()),
        ))
        imps.append(pd.Series(model.feature_importances_, index=feature_cols))
        if verbose:
            print(f"  fold {k}: train={len(tr):5d} test={len(te):4d} "
                  f"AUC={auc:.3f} base={yte.mean():.3f} "
                  f"prec@{mc.prob_threshold}={prec:.3f} n={int(taken.sum())}")

    final = lgb.LGBMClassifier(**mc.lgbm_params, random_state=cfg.seed)
    final.fit(X_all, y_all, sample_weight=weights)

    importance = (
        pd.concat(imps, axis=1).mean(axis=1).sort_values(ascending=False)
        if imps else pd.Series(final.feature_importances_, index=feature_cols)
        .sort_values(ascending=False)
    )

    oof_df = labels.copy()
    oof_df["p_win"] = oof
    return final, oof_df, reports, importance


def save_bundle(model, feature_cols, cfg, importance, reports, name="qsmc_meta"):
    """Persist everything needed to reproduce a live decision."""
    import joblib

    path = Path(ARTIFACT_DIR) / f"{name}.joblib"
    joblib.dump({
        "model": model,
        "feature_cols": list(feature_cols),
        "config": cfg.to_dict(),
        "importance": importance.to_dict(),
    }, path)
    (Path(ARTIFACT_DIR) / f"{name}_folds.json").write_text(
        json.dumps([asdict(r) for r in reports], indent=2))
    return path


def load_bundle(name: str = "qsmc_meta"):
    import joblib
    return joblib.load(Path(ARTIFACT_DIR) / f"{name}.joblib")
