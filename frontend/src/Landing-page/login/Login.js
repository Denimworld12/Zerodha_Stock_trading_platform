import React, { useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../../lib/api";
import { DASHBOARD_URL } from "../../config";
import "./auth.css";

/**
 * Sign in.
 *
 * The previous version posted to http://localhost:5000/api/login — a port
 * nothing has ever listened on — stored whatever came back in localStorage, and
 * alerted "Invalid credentials" for every failure including the network error
 * it always got. This talks to the real API.
 */
const Login = () => {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(form.email, form.password);
      // The dashboard is a separate origin, so a full navigation is needed.
      // Its own boot exchanges the httpOnly refresh cookie for an access token,
      // which is why nothing is passed in the URL.
      window.location.assign(DASHBOARD_URL);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-box" onSubmit={submit}>
        <h2>Sign in</h2>
        <p className="auth-lead">Welcome back.</p>

        <label>
          <span>Email</span>
          <input name="email" type="email" value={form.email} onChange={change}
                 autoComplete="email" required autoFocus />
        </label>

        <label>
          <span>Password</span>
          <input name="password" type="password" value={form.password} onChange={change}
                 autoComplete="current-password" required />
        </label>

        {error && <div className="auth-err" role="alert">{error}</div>}

        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>

        <p className="auth-alt">
          Don't have an account? <Link to="/signup">Create one</Link>
        </p>
      </form>
    </div>
  );
};

export default Login;
