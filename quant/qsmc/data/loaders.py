"""OHLCV loaders.

All loaders return the same contract: a ``pandas.DataFrame`` indexed by a
tz-aware UTC ``DatetimeIndex`` with float columns
``[open, high, low, close, volume]``, sorted ascending, no duplicate index.

Sources
-------
``binance``  free public REST, no API key, spot klines - used for the
             reference backtest because it is reproducible by anyone.
``csv``      MetaTrader "Export bars" dumps or any generic CSV.
``mt5``      live MetaTrader 5 terminal (Windows only, optional dependency).
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

from ..config import CACHE_DIR

OHLCV = ["open", "high", "low", "close", "volume"]

BINANCE_INTERVALS = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600, "12h": 43200,
    "1d": 86400,
}


def _normalise(df: pd.DataFrame) -> pd.DataFrame:
    """Enforce the shared OHLCV contract."""
    df = df.copy()
    df.columns = [str(c).strip().lower() for c in df.columns]
    missing = [c for c in OHLCV if c not in df.columns]
    if missing:
        raise ValueError(f"missing OHLCV columns: {missing}")
    df = df[OHLCV].astype("float64")

    if not isinstance(df.index, pd.DatetimeIndex):
        raise TypeError("index must be a DatetimeIndex")
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    else:
        df.index = df.index.tz_convert("UTC")

    df = df[~df.index.duplicated(keep="last")].sort_index()
    df.index.name = "time"

    # Structural sanity: a bar whose high < low or whose OHLC sit outside
    # [low, high] is corrupt data and will silently poison every downstream
    # feature, so drop it loudly rather than quietly.
    bad = (
        (df["high"] < df["low"])
        | (df["open"] > df["high"]) | (df["open"] < df["low"])
        | (df["close"] > df["high"]) | (df["close"] < df["low"])
        | df[OHLCV].isna().any(axis=1)
    )
    if int(bad.sum()):
        df = df[~bad]
    return df


# ---------------------------------------------------------------------------
# Binance public REST
# ---------------------------------------------------------------------------
def fetch_binance(
    symbol: str,
    interval: str = "15m",
    start: str | datetime | None = None,
    end: str | datetime | None = None,
    limit_bars: int = 20_000,
    session: requests.Session | None = None,
) -> pd.DataFrame:
    """Page through Binance spot klines.

    The endpoint is public and rate limited; we page forward from ``start``
    using the last returned open-time so no bars are skipped or duplicated.
    """
    if interval not in BINANCE_INTERVALS:
        raise ValueError(f"interval must be one of {sorted(BINANCE_INTERVALS)}")

    sess = session or requests.Session()
    step_ms = BINANCE_INTERVALS[interval] * 1000

    if start is None:
        start_ms = int(time.time() * 1000) - limit_bars * step_ms
    else:
        start_ms = int(pd.Timestamp(start, tz="UTC").timestamp() * 1000)
    end_ms = (
        int(time.time() * 1000)
        if end is None
        else int(pd.Timestamp(end, tz="UTC").timestamp() * 1000)
    )

    rows: list[list] = []
    cursor = start_ms
    while cursor < end_ms and len(rows) < limit_bars:
        resp = sess.get(
            "https://api.binance.com/api/v3/klines",
            params={
                "symbol": symbol.upper(),
                "interval": interval,
                "startTime": cursor,
                "endTime": end_ms,
                "limit": 1000,
            },
            timeout=20,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        rows.extend(batch)
        nxt = batch[-1][0] + step_ms
        if nxt <= cursor:          # no forward progress -> stop, don't spin
            break
        cursor = nxt
        if len(batch) < 1000:
            break
        time.sleep(0.12)           # stay well inside the weight limit

    if not rows:
        raise RuntimeError(f"binance returned no data for {symbol} {interval}")

    df = pd.DataFrame(rows, columns=[
        "open_time", "open", "high", "low", "close", "volume", "close_time",
        "quote_volume", "trades", "taker_base", "taker_quote", "ignore",
    ])
    df.index = pd.to_datetime(df["open_time"].astype("int64"), unit="ms", utc=True)
    return _normalise(df).iloc[:limit_bars]


def load_cached(
    symbol: str,
    interval: str = "15m",
    limit_bars: int = 20_000,
    source: str = "binance",
    refresh: bool = False,
) -> pd.DataFrame:
    """Fetch once, reuse forever. Keeps backtests reproducible offline."""
    path = CACHE_DIR / f"{source}_{symbol.upper()}_{interval}_{limit_bars}.parquet"
    csv_path = path.with_suffix(".csv.gz")

    if not refresh:
        for p, reader in ((path, pd.read_parquet), (csv_path, _read_csv_cache)):
            if p.exists():
                try:
                    return _normalise(reader(p))
                except Exception:
                    pass  # corrupt cache -> refetch

    df = fetch_binance(symbol, interval, limit_bars=limit_bars)
    try:
        df.to_parquet(path)
    except Exception:
        df.to_csv(csv_path)        # pyarrow not installed -> gzip csv fallback
    return df


def _read_csv_cache(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, index_col=0, parse_dates=True)


# ---------------------------------------------------------------------------
# Generic / MetaTrader CSV
# ---------------------------------------------------------------------------
def load_csv(
    path: str | Path,
    time_col: str | None = None,
    tz: str = "UTC",
) -> pd.DataFrame:
    """Read a CSV or MetaTrader bar export.

    Handles the MT5 ``<DATE>\\t<TIME>\\t<OPEN>...`` tab-separated layout as well
    as ordinary comma-separated files with a single timestamp column.
    """
    path = Path(path)
    raw = pd.read_csv(path, sep=None, engine="python")
    raw.columns = [str(c).strip().strip("<>").lower() for c in raw.columns]

    if "date" in raw.columns and "time" in raw.columns:
        idx = pd.to_datetime(
            raw["date"].astype(str) + " " + raw["time"].astype(str),
            format="mixed",
        )
    else:
        col = time_col or next(
            (c for c in ("time", "timestamp", "datetime", "date") if c in raw.columns),
            raw.columns[0],
        )
        idx = pd.to_datetime(raw[col], format="mixed")

    raw = raw.rename(columns={"tickvol": "volume", "vol": "volume", "tick_volume": "volume"})
    if "volume" not in raw.columns:
        raw["volume"] = 0.0

    raw.index = idx
    if raw.index.tz is None:
        raw.index = raw.index.tz_localize(tz)
    return _normalise(raw)


# ---------------------------------------------------------------------------
# MetaTrader 5 terminal
# ---------------------------------------------------------------------------
_MT5_TIMEFRAMES = {
    "1m": "TIMEFRAME_M1", "5m": "TIMEFRAME_M5", "15m": "TIMEFRAME_M15",
    "30m": "TIMEFRAME_M30", "1h": "TIMEFRAME_H1", "4h": "TIMEFRAME_H4",
    "1d": "TIMEFRAME_D1",
}


def load_mt5(symbol: str, interval: str = "15m", bars: int = 20_000) -> pd.DataFrame:
    """Pull bars straight from a running MetaTrader 5 terminal.

    Requires ``pip install MetaTrader5`` and a logged-in terminal on the same
    machine (Windows, or Wine). Import is deferred so the rest of the package
    works everywhere.
    """
    try:
        import MetaTrader5 as mt5
    except ImportError as exc:                                # pragma: no cover
        raise RuntimeError(
            "MetaTrader5 package not installed. `pip install MetaTrader5` "
            "(Windows only) or export bars to CSV and use load_csv()."
        ) from exc

    if not mt5.initialize():
        raise RuntimeError(f"mt5.initialize() failed: {mt5.last_error()}")
    try:
        tf = getattr(mt5, _MT5_TIMEFRAMES[interval])
        rates = mt5.copy_rates_from(symbol, tf, datetime.now(timezone.utc), bars)
        if rates is None or len(rates) == 0:
            raise RuntimeError(f"no MT5 rates for {symbol}: {mt5.last_error()}")
        df = pd.DataFrame(rates)
        df.index = pd.to_datetime(df["time"], unit="s", utc=True)
        df = df.rename(columns={"tick_volume": "volume"})
        return _normalise(df)
    finally:
        mt5.shutdown()


def resample(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    """Aggregate to a higher timeframe (used for HTF bias).

    Bars are labelled by their OPEN time to match the loader convention, so a
    bar stamped 11:00 covers [11:00, 12:00) and is only complete at 12:00.
    Callers must shift before merging down - see features.build.htf_block.
    """
    out = df.resample(rule, label="left", closed="left").agg({
        "open": "first", "high": "max", "low": "min",
        "close": "last", "volume": "sum",
    })
    return out.dropna(subset=["open", "high", "low", "close"])


# ---------------------------------------------------------------------------
# Yahoo Finance — free FX history, no API key
# ---------------------------------------------------------------------------
#
# This exists to answer the question the crypto backtest could not: does the
# Mirror-Market concept work on a GENUINE mirror pair? Binance quotes everything
# in USDT, so BTC/ETH measured rho = +0.85 — a hedge pair, not a mirror. EURUSD
# and USDCHF are the textbook inverse pair, and Yahoo serves ~2.8 years of
# hourly FX bars for free.
#
# Caveats worth stating plainly:
#   * FX "volume" from Yahoo is tick count or zero, NOT traded size. Any
#     volume-derived feature is meaningless here and must be treated as absent.
#   * Bars are indicative mid prices from an aggregator, not a specific broker's
#     executable stream. Fine for measuring whether an edge EXISTS; not fine for
#     estimating what it would have paid after spread. Use MT5/OANDA data before
#     trusting any P&L figure.
YAHOO_FX = {
    "EURUSD": "EURUSD=X",
    "USDCHF": "CHF=X",     # Yahoo quotes USD/CHF under CHF=X
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "JPY=X",
    "AUDUSD": "AUDUSD=X",
    "USDCAD": "CAD=X",
    "NZDUSD": "NZDUSD=X",
    "XAUUSD": "GC=F",      # gold futures, the nearest free proxy
}

_YAHOO_INTERVALS = {"1m", "2m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo"}


def fetch_yahoo(
    symbol: str,
    interval: str = "1h",
    period: str = "730d",
    session: requests.Session | None = None,
) -> pd.DataFrame:
    """Download OHLCV from Yahoo's chart endpoint.

    ``symbol`` accepts either our own name (``EURUSD``) or a raw Yahoo ticker
    (``EURUSD=X``). Yahoo caps intraday history: roughly 730 days at 1h and
    60 days at 15m or finer.
    """
    if interval not in _YAHOO_INTERVALS:
        raise ValueError(f"interval must be one of {sorted(_YAHOO_INTERVALS)}")

    ticker = YAHOO_FX.get(symbol.upper(), symbol)
    sess = session or requests.Session()
    resp = sess.get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}",
        params={"range": period, "interval": interval},
        headers={"User-Agent": "Mozilla/5.0"},   # Yahoo 403s an empty agent
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json().get("chart", {})
    if payload.get("error"):
        raise RuntimeError(f"yahoo error for {ticker}: {payload['error']}")

    result = payload["result"][0]
    quote = result["indicators"]["quote"][0]
    df = pd.DataFrame({
        "open": quote["open"],
        "high": quote["high"],
        "low": quote["low"],
        "close": quote["close"],
        "volume": quote.get("volume") or [0] * len(result["timestamp"]),
    })
    df.index = pd.to_datetime(result["timestamp"], unit="s", utc=True)

    # Yahoo emits nulls for closed sessions; a bar with no close never traded.
    df = df.dropna(subset=["open", "high", "low", "close"])
    df["volume"] = df["volume"].fillna(0.0)
    return _normalise(df)


def load_fx(
    symbol: str,
    interval: str = "1h",
    period: str = "730d",
    refresh: bool = False,
) -> pd.DataFrame:
    """Cached Yahoo FX loader, mirroring :func:`load_cached`.

    Yahoo has no native 4h bar, so 4h is built by resampling 1h. That caps 4h
    history at Yahoo's 1h limit of ~730 days; daily goes back a decade and is
    fetched directly.

    Note `period="max"` is a trap for daily bars — Yahoo switches to monthly
    aggregation and returns ~274 rows instead of thousands. Use "10y".
    """
    if interval == "4h":
        hourly = load_fx(symbol, "1h", period, refresh)
        return resample(hourly, "4h")

    path = CACHE_DIR / f"yahoo_{symbol.upper()}_{interval}_{period}.parquet"
    csv_path = path.with_suffix(".csv.gz")

    if not refresh:
        for p, reader in ((path, pd.read_parquet), (csv_path, _read_csv_cache)):
            if p.exists():
                try:
                    return _normalise(reader(p))
                except Exception:
                    pass

    df = fetch_yahoo(symbol, interval, period)
    try:
        df.to_parquet(path)
    except Exception:
        df.to_csv(csv_path)
    return df
