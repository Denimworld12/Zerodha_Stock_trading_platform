import React, { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import "./Tables.css";
import "./Funds.css";

/**
 * Trade journal and performance.
 *
 * The screen is built around one idea most trading dashboards get wrong: a hit
 * rate over eleven trades is noise, and showing it as a headline number invites
 * people to act on luck. So the confidence interval on expectancy is shown next
 * to it, and when the sample is too small the panel says so in words rather
 * than quietly rendering a confident percentage.
 */
const money = (v) =>
  Number(v || 0).toLocaleString("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 2,
  });
const pct = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;

const WINDOWS = [
  { label: "All time", days: null },
  { label: "90 days", days: 90 },
  { label: "30 days", days: 30 },
  { label: "7 days", days: 7 },
];

const Journal = () => {
  const [perf, setPerf] = useState(null);
  const [trades, setTrades] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [windowDays, setWindowDays] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = windowDays ? `?days=${windowDays}` : "";
      const [p, t, b] = await Promise.all([
        api.get(`/api/v2/journal/performance${q}`),
        api.get("/api/v2/journal/trades?limit=200"),
        api.get("/api/v2/journal/breakdown"),
      ]);
      setPerf(p);
      setTrades(t);
      setBreakdown(b);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="table-error">{error}</div>;
  if (loading && !perf) return <p className="table-loading">Loading journal…</p>;
  if (!perf) return null;

  const [lo, hi] = perf.expectancy95 || [0, 0];
  // An interval straddling zero means the edge is unproven, however good the
  // point estimate looks. That is the whole message of this panel.
  const edgeProven = perf.significant && lo > 0;

  return (
    <div className="funds-page">
      <div className="funds-header">
        <div>
          <h3>Trade journal</h3>
          <p className="funds-sub">
            Every figure derived from the ledger — reconstructible, not stored.
          </p>
        </div>
        <div style={{ display: "flex", gap: ".4rem" }}>
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              onClick={() => setWindowDays(w.days)}
              className={windowDays === w.days ? "btn-primary" : "btn-ghost"}
              style={{ padding: ".35rem .7rem", fontSize: ".8rem" }}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {perf.trades === 0 ? (
        <div className="table-empty">
          <p>No closed trades yet.</p>
          <p className="muted">Close a position and it will be analysed here.</p>
        </div>
      ) : (
        <>
          {/* The honest verdict, stated before any of the flattering numbers. */}
          <div className={`funds-audit ${edgeProven ? "ok" : "bad"}`}
               style={!perf.significant ? { background: "#fffbeb", borderColor: "#fde68a", color: "#78350f" } : {}}>
            {!perf.significant ? (
              <>
                <strong>{perf.trades} trades is too few to conclude anything.</strong>{" "}
                Below about 30, a hit rate is dominated by luck. The numbers below
                are real, but they are not yet evidence of a system that works.
              </>
            ) : edgeProven ? (
              <>
                <strong>Expectancy is positive with 95% confidence</strong>{" "}
                ({money(lo)} to {money(hi)} per trade over {perf.trades} trades).
              </>
            ) : (
              <>
                <strong>No demonstrated edge.</strong> Expectancy of{" "}
                {money(perf.expectancy)} has a 95% interval of {money(lo)} to{" "}
                {money(hi)} — it straddles zero, so this is consistent with
                having no edge at all.
              </>
            )}
          </div>

          <div className="funds-grid">
            <div className="funds-tile">
              <span className="tile-label">Net realised</span>
              <span className={`tile-value ${perf.realisedPnl >= 0 ? "gain" : "loss"}`}>
                {money(perf.realisedPnl)}
              </span>
              <span className="tile-hint">{perf.trades} closed trades</span>
            </div>
            <div className="funds-tile">
              <span className="tile-label">Win rate</span>
              <span className="tile-value">{pct(perf.winRate)}</span>
              <span className="tile-hint">
                {perf.significant ? "sample is adequate" : "sample too small"}
              </span>
            </div>
            <div className="funds-tile">
              <span className="tile-label">Expectancy</span>
              <span className={`tile-value ${perf.expectancy >= 0 ? "gain" : "loss"}`}>
                {money(perf.expectancy)}
              </span>
              <span className="tile-hint">± {money(perf.expectancyStdErr)} std err</span>
            </div>
            <div className="funds-tile">
              <span className="tile-label">Profit factor</span>
              <span className="tile-value">
                {perf.profitFactor == null ? "—" : perf.profitFactor.toFixed(2)}
              </span>
              <span className="tile-hint">gross win ÷ gross loss</span>
            </div>
            <div className="funds-tile">
              <span className="tile-label">Max drawdown</span>
              <span className="tile-value loss">{pct(perf.maxDrawdown)}</span>
              <span className="tile-hint">peak to trough, settled equity</span>
            </div>
            <div className="funds-tile">
              <span className="tile-label">Fees paid</span>
              <span className="tile-value">{money(perf.feesPaid)}</span>
              <span className="tile-hint">
                {perf.realisedPnl !== 0
                  ? `${Math.abs(Number(perf.feesPaid) / perf.realisedPnl).toFixed(1)}× your net P&L`
                  : "spread and commission"}
              </span>
            </div>
          </div>

          {breakdown.length > 0 && (
            <>
              <div className="table-head" style={{ marginTop: "1.75rem" }}>
                <h3>By instrument</h3>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th><th className="num">Trades</th>
                      <th className="num">Win rate</th><th className="num">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.map((b) => (
                      <tr key={b.symbol}>
                        <td className="sym">{b.symbol}</td>
                        <td className="num">{b.trades}</td>
                        <td className="num">{pct(b.winRate)}</td>
                        <td className={`num ${b.net >= 0 ? "gain" : "loss"}`}>{money(b.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="table-head" style={{ marginTop: "1.75rem" }}>
            <h3>Recent trades</h3>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Closed</th><th>Symbol</th><th>Side</th>
                  <th className="num">Qty</th><th className="num">Exit</th>
                  <th className="num">P&amp;L</th><th className="num">Fees</th>
                  <th className="num">Net</th><th>Source</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id}>
                    <td className="dim">{new Date(t.closedAt).toLocaleString()}</td>
                    <td className="sym">{t.symbol}</td>
                    <td><span className={`pill ${t.side}`}>{t.side}</span></td>
                    <td className="num">{t.quantity}</td>
                    <td className="num">{Number(t.exitPrice).toFixed(2)}</td>
                    <td className={`num ${Number(t.pnl) >= 0 ? "gain" : "loss"}`}>{money(t.pnl)}</td>
                    <td className="num dim">{money(t.fees)}</td>
                    <td className={`num ${Number(t.net) >= 0 ? "gain" : "loss"}`}>{money(t.net)}</td>
                    <td className="dim">{t.strategyId || t.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="funds-footnote">
        A 95% confidence interval that includes zero means the results so far are
        consistent with no edge — however good the average looks. That is the
        number worth watching, not the win rate.
      </p>
    </div>
  );
};

export default Journal;
