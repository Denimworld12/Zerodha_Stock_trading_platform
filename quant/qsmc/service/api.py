"""FastAPI signal service.

Sits between the quant engine and everything else:

    React dashboard  --GET  /signals----------> this service
    TradingView      --POST /webhook/tradingview-> this service --> broker
    this service     --POST /order-------------> Express app (paper fills)

Run:
    PYTHONPATH=quant uvicorn qsmc.service.api:app --port 8000 --reload
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ..config import ARTIFACT_DIR, CONFIG
from ..execution.base import Signal, position_size
from ..execution.paper import PaperBroker
from ..live import generate_signal
from ..model.train import load_bundle

app = FastAPI(
    title="QSMC Signal Service",
    version="0.1.0",
    description="SMC + Mirror-Market signals, research results and paper execution.",
)

# The dashboard is a separate origin (CRA on :3000). Locked to explicit origins
# rather than "*" because these endpoints can place orders.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "QSMC_CORS_ORIGINS", "http://localhost:3000,http://localhost:3001"
    ).split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

WEBHOOK_SECRET = os.getenv("SIGNAL_WEBHOOK_SECRET", "")
EXECUTION_ENABLED = os.getenv("QSMC_EXECUTION_ENABLED", "false").lower() == "true"
DEFAULT_SYMBOLS = os.getenv("QSMC_SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT").split(",")

_bundle = None


def bundle():
    """Lazy-load the model so the service starts even before one is trained."""
    global _bundle
    if _bundle is None:
        try:
            _bundle = load_bundle()
        except Exception:
            _bundle = {}
    return _bundle or None


def require_secret(provided: str | None) -> None:
    if not WEBHOOK_SECRET:
        raise HTTPException(503, "SIGNAL_WEBHOOK_SECRET is not configured; refusing")
    if provided != WEBHOOK_SECRET:
        raise HTTPException(401, "bad or missing secret")


# ---------------------------------------------------------------------------
class TVAlert(BaseModel):
    """Payload a TradingView alert should POST (Pine `alert()` message body)."""
    symbol: str
    side: str = Field(description="buy | sell | long | short | flat")
    price: float | None = None
    stop: float | None = None
    target: float | None = None
    timeframe: str = "15m"
    strategy: str = "tradingview"
    comment: str = ""


class ExecuteRequest(BaseModel):
    symbol: str
    dry_run: bool = True


# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    b = bundle()
    return {
        "ok": True,
        "time": datetime.now(timezone.utc).isoformat(),
        "model_loaded": bool(b),
        "n_features": len(b["feature_cols"]) if b else 0,
        "execution_enabled": EXECUTION_ENABLED,
        "webhook_secret_set": bool(WEBHOOK_SECRET),
        "prob_threshold": CONFIG.model.prob_threshold,
    }


@app.get("/signals")
def signals(
    symbols: str = Query(default=",".join(DEFAULT_SYMBOLS)),
    interval: str = "15m",
    refresh: bool = False,
):
    """Current signal for each symbol, including the ones that were blocked.

    Blocked setups are returned rather than filtered out: a dashboard that only
    shows fires cannot tell "nothing set up" from "the service is broken".
    """
    out = []
    for sym in [s.strip().upper() for s in symbols.split(",") if s.strip()]:
        try:
            ctx = generate_signal(sym, interval, model_bundle=bundle(), refresh=refresh)
            out.append({
                "symbol": sym,
                "bar_time": ctx.bar_time.isoformat(),
                "close": ctx.close,
                "atr": ctx.atr,
                "primary": ctx.primary,
                "p_win": round(ctx.p_win, 4),
                "blocked_by": ctx.blocked_by,
                "signal": ctx.signal.to_dict() if ctx.signal else None,
            })
        except Exception as exc:
            out.append({"symbol": sym, "error": str(exc)})
    return {"interval": interval, "generated_at": datetime.now(timezone.utc).isoformat(),
            "signals": out}


@app.get("/research/summary")
def research_summary():
    """The walk-forward results. The dashboard shows these next to any signal."""
    path = ARTIFACT_DIR / "experiment_results.json"
    if not path.exists():
        raise HTTPException(404, "no experiment results; run scripts/run_experiment.py")
    data = json.loads(path.read_text())
    return {
        "labels": data.get("labels"),
        "mean_oof_auc": data.get("mean_oof_auc"),
        "results": data.get("results"),
        "top_features": dict(list((data.get("top_features") or {}).items())[:15]),
        "verdict": data.get("verdict", "See mean_oof_auc: 0.5 means no predictive edge."),
    }


@app.post("/webhook/tradingview")
async def tradingview_webhook(
    alert: TVAlert,
    request: Request,
    x_signal_secret: str | None = Header(default=None),
):
    """Receive a TradingView alert.

    TradingView cannot place orders itself; it fires this webhook and we decide.
    The alert is treated as an UNTRUSTED suggestion: it is recorded and echoed
    back, never auto-executed. Anyone who learns the URL can POST to it, so a
    payload from here must clear the same risk gates as our own signals.
    """
    require_secret(x_signal_secret)
    record = {
        "received_at": datetime.now(timezone.utc).isoformat(),
        "source_ip": request.client.host if request.client else None,
        "alert": alert.model_dump(),
    }
    log = ARTIFACT_DIR / "tradingview_alerts.jsonl"
    with log.open("a") as fh:
        fh.write(json.dumps(record) + "\n")
    return {"accepted": True, "executed": False,
            "note": "recorded only; external alerts are never auto-executed",
            "record": record}


@app.post("/execute")
def execute(req: ExecuteRequest, x_signal_secret: str | None = Header(default=None)):
    """Route the current signal for a symbol to the paper broker.

    Three independent locks, all of which must be open: a shared secret, the
    QSMC_EXECUTION_ENABLED env flag, and an explicit ``dry_run=false``. Any one
    of them closed means nothing is sent.
    """
    require_secret(x_signal_secret)
    if not EXECUTION_ENABLED:
        raise HTTPException(403, "execution disabled; set QSMC_EXECUTION_ENABLED=true")

    ctx = generate_signal(req.symbol.upper(), model_bundle=bundle(), refresh=True)
    if ctx.signal is None:
        return {"executed": False, "reason": ctx.blocked_by}

    broker = PaperBroker()
    equity = broker.equity()
    qty = position_size(equity, ctx.signal, CONFIG.risk.risk_per_trade,
                        CONFIG.risk.max_leverage)
    if req.dry_run:
        return {"executed": False, "dry_run": True, "equity": equity,
                "qty": qty, "signal": ctx.signal.to_dict()}

    fill = broker.submit(ctx.signal, qty)
    return {"executed": fill.ok, "message": fill.message, "qty": qty,
            "equity": equity, "signal": ctx.signal.to_dict()}
