import React, { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import "./Funds.css";

/**
 * Funds, derived from the ledger.
 *
 * The old version read a single mutable `Fund` document that the server
 * incremented in place — no history, and no way to tell when a wrong balance
 * went wrong. These numbers are the sum of the account's ledger entries, so
 * every one of them is traceable to the postings that produced it.
 *
 * Amounts are STRINGS all the way from the database to this component. Parsing
 * them into JavaScript numbers for display is fine; parsing them to do
 * arithmetic is not, because doubles cannot represent decimal money exactly.
 */

const money = (value, currency = "INR") => {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString("en-IN", {
    style: "currency", currency, maximumFractionDigits: 2,
  });
};

const Funds = () => {
  const [balances, setBalances] = useState(null);
  const [currency, setCurrency] = useState("INR");
  const [auditResult, setAuditResult] = useState(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const [b, a] = await Promise.all([api.balances(), api.audit()]);
      setBalances(b.balances);
      setCurrency(b.currency);
      setAuditResult(a);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitDeposit = async (e) => {
    e.preventDefault();
    const amt = amount.trim();
    if (!amt || Number(amt) <= 0) {
      setError("Enter an amount greater than zero");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.deposit(amt);
      setBalances(res.balances);
      setAmount("");
      setNotice(`Added ${money(amt, currency)} to your paper account`);
      setTimeout(() => setNotice(null), 4000);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Reset this paper account to its opening balance?")) return;
    setBusy(true);
    try {
      const res = await api.resetAccount();
      setBalances(res.balances);
      setNotice("Paper account reset. The adjustment is recorded in your ledger.");
      setTimeout(() => setNotice(null), 5000);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !balances) return <div className="funds-error">{error}</div>;
  if (!balances) return <p className="funds-loading">Loading…</p>;

  const rows = [
    ["Available cash", balances.cash, "Settled and free to trade"],
    ["Used margin", balances.margin, "Committed to open positions"],
    ["Realised P&L", balances.pnl ? String(-Number(balances.pnl)) : "0", "Booked on closed trades"],
    ["Fees paid", balances.fees, "Commission and spread"],
  ];

  return (
    <div className="funds-page">
      <div className="funds-header">
        <div>
          <h3>Funds</h3>
          <p className="funds-sub">
            Every figure below is the sum of your ledger entries, not a stored number.
          </p>
        </div>
        <div className="funds-equity">
          <span className="label">Equity</span>
          <span className="value">{money(balances.equity, currency)}</span>
        </div>
      </div>

      {notice && <div className="funds-notice">{notice}</div>}
      {error && <div className="funds-error">{error}</div>}

      <div className="funds-grid">
        {rows.map(([label, value, hint]) => (
          <div className="funds-tile" key={label}>
            <span className="tile-label">{label}</span>
            <span className="tile-value">{money(value, currency)}</span>
            <span className="tile-hint">{hint}</span>
          </div>
        ))}
      </div>

      {/* An audit is cheap and it is the only real safety net, so it is shown
          rather than hidden behind an admin page. */}
      {auditResult && (
        <div className={`funds-audit ${auditResult.ok ? "ok" : "bad"}`}>
          {auditResult.ok ? (
            <>
              <strong>Books balance.</strong> Debits equal credits across{" "}
              {auditResult.perCurrency?.[0]?.entries ?? 0} ledger entries.
            </>
          ) : (
            <>
              <strong>Ledger does not balance.</strong>{" "}
              {auditResult.unbalancedTransactions?.length} unbalanced transaction(s).
              This should never happen — please report it.
            </>
          )}
        </div>
      )}

      <form className="funds-actions" onSubmit={submitDeposit}>
        <label>
          <span>Add paper funds</span>
          <input
            type="text" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="10000" disabled={busy}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Working…" : "Deposit"}
        </button>
        <button type="button" className="btn-ghost" onClick={reset} disabled={busy}>
          Reset account
        </button>
      </form>

      <p className="funds-footnote">
        This is a paper account: the money is not real. Deposits and resets are
        recorded as ledger postings, so your history stays complete — a reset
        adds a correcting entry rather than erasing what happened.
      </p>
    </div>
  );
};

export default Funds;
