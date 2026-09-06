import React, { useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../../lib/api";
import { DASHBOARD_URL } from "../../config";
import "./../login/auth.css";

/**
 * Create an account.
 *
 * Password rules come back from the server as a list of specific problems, so
 * they are shown as a list. "Invalid password" tells someone nothing about what
 * to change.
 */
const Signup = () => {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.register(form.email, form.password, form.name);
      window.location.assign(DASHBOARD_URL);
    } catch (err) {
      setError(err.issues?.length ? err.issues.join("; ") : err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-box" onSubmit={submit}>
        <h2>Create an account</h2>
        <p className="auth-lead">
          You'll start with a funded paper trading account. No real money is involved.
        </p>

        <label>
          <span>Name</span>
          <input name="name" type="text" value={form.name} onChange={change}
                 autoComplete="name" placeholder="Optional" />
        </label>

        <label>
          <span>Email</span>
          <input name="email" type="email" value={form.email} onChange={change}
                 autoComplete="email" required />
        </label>

        <label>
          <span>Password</span>
          <input name="password" type="password" value={form.password} onChange={change}
                 autoComplete="new-password" required minLength={10} />
          <small>At least 10 characters. A memorable phrase beats a short password with symbols.</small>
        </label>

        {error && <div className="auth-err" role="alert">{error}</div>}

        <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>

        <p className="auth-alt">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
};

export default Signup;
