"""Central configuration for the SMC + Mirror-Market engine.

Every tunable lives here so that backtest, training and live execution are
guaranteed to run the *same* parameters.  Anything read from the environment is
resolved once, at import time.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = Path(os.getenv("QSMC_CACHE", ROOT / "data_cache"))
ARTIFACT_DIR = Path(os.getenv("QSMC_ARTIFACTS", ROOT / "artifacts"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class StructureConfig:
    """Fractal swing / market-structure detection."""

    swing_lookback: int = 3          # bars either side of a pivot
    htf_multiplier: int = 12         # higher-timeframe = base * this (e.g. 5m -> 1h)
    equal_level_atr_frac: float = 0.15   # EQH/EQL tolerance, in ATR units
    max_zone_age: int = 200          # bars an order block / FVG stays valid


@dataclass(frozen=True)
class MirrorConfig:
    """Mirror-Market Concept parameters.

    Three distinct, independently testable readings of "mirror":

    1. ``inverse``  - an instrument locked to this one by a stable hedge ratio.
       The textbook case is anti-correlated (EURUSD/USDCHF, rho ~= -0.9), but a
       strongly POSITIVELY correlated leg is the same object viewed from the
       other side: its mirror is simply the short. What matters is that the
       beta-hedged spread is stationary, not the sign of rho - so the regime
       test is on |rho| and beta carries the sign.
    2. ``foldback`` - fractal time symmetry: the last N bars compared against
       the time-reversed, price-inverted window that preceded the pivot.
    3. ``leadlag``  - which leg moves first, measured by lagged cross-correlation.
    """

    corr_window: int = 240           # bars for rolling correlation / beta
    spread_z_window: int = 240       # bars for spread z-score
    min_abs_corr: float = 0.50       # |rho| below this => no stable mirror at all
    foldback_window: int = 48        # bars folded around the pivot
    max_lead_lag: int = 12           # bars searched either side for lead/lag
    divergence_z: float = 1.8        # |z| that counts as a dislocation


@dataclass(frozen=True)
class LabelConfig:
    """Triple-barrier labelling (Lopez de Prado, AFML ch. 3)."""

    atr_period: int = 14
    profit_atr: float = 2.0          # upper barrier, in ATR
    stop_atr: float = 1.0            # lower barrier, in ATR
    max_holding: int = 48            # vertical barrier, in bars
    min_ret: float = 0.0             # dead-zone for the sign of the label


@dataclass(frozen=True)
class RiskConfig:
    """Position sizing and portfolio guard rails."""

    risk_per_trade: float = 0.0075   # 0.75% of equity risked per trade
    max_concurrent: int = 3
    max_daily_loss: float = 0.03     # kill switch: 3% equity drawdown in a day
    max_total_drawdown: float = 0.20 # kill switch: stop trading entirely
    min_rr: float = 1.5              # reject setups whose target/stop is worse
    max_leverage: float = 5.0


@dataclass(frozen=True)
class CostConfig:
    """Execution frictions. Defaults are deliberately pessimistic."""

    spread_bps: float = 2.0          # half-spread paid on entry AND exit
    commission_bps: float = 1.0      # per side
    slippage_bps: float = 1.5        # per side, market orders
    funding_bps_per_day: float = 0.0 # perp funding / swap

    @property
    def round_trip_bps(self) -> float:
        return 2 * (self.spread_bps + self.commission_bps + self.slippage_bps)


@dataclass(frozen=True)
class ModelConfig:
    """Meta-labelling model + walk-forward validation."""

    n_splits: int = 5
    embargo_frac: float = 0.01       # embargo either side of each test fold
    min_train_bars: int = 3000
    prob_threshold: float = 0.58     # take the trade only above this p(win)
    lgbm_params: dict = field(default_factory=lambda: {
        "objective": "binary",
        "n_estimators": 400,
        "learning_rate": 0.03,
        "num_leaves": 15,
        "max_depth": 4,
        "min_child_samples": 60,
        "subsample": 0.8,
        "subsample_freq": 1,
        "colsample_bytree": 0.7,
        "reg_alpha": 0.5,
        "reg_lambda": 2.0,
        "verbosity": -1,
        "n_jobs": 2,
    })


@dataclass(frozen=True)
class Config:
    structure: StructureConfig = field(default_factory=StructureConfig)
    mirror: MirrorConfig = field(default_factory=MirrorConfig)
    label: LabelConfig = field(default_factory=LabelConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    cost: CostConfig = field(default_factory=CostConfig)
    model: ModelConfig = field(default_factory=ModelConfig)
    seed: int = 42

    def to_dict(self) -> dict:
        return asdict(self)


CONFIG = Config()

# ---------------------------------------------------------------------------
# Instrument universe.  ``mirror`` names the structurally inverse instrument
# used by the Mirror-Market features; ``beta_ref`` is the risk driver.
# ---------------------------------------------------------------------------
MIRROR_MAP: dict[str, str] = {
    # Crypto (Binance spot, free public data - used for the reference backtest)
    "BTCUSDT": "ETHUSDT",
    "ETHUSDT": "BTCUSDT",
    "BNBUSDT": "BTCUSDT",
    "SOLUSDT": "BTCUSDT",
    # FX (MetaTrader / OANDA). EURUSD<->USDCHF is the textbook mirror pair.
    "EURUSD": "USDCHF",
    "USDCHF": "EURUSD",
    "GBPUSD": "USDCHF",
    "AUDUSD": "USDJPY",
    "USDJPY": "AUDUSD",
    "XAUUSD": "USDCHF",
}


def mirror_of(symbol: str) -> str | None:
    return MIRROR_MAP.get(symbol.upper().replace("/", "").replace("_", ""))
