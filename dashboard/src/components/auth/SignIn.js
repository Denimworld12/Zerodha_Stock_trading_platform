import React, { useState } from "react";
import { useAuth } from "../../lib/AuthContext";
import "./SignIn.css";

/**
 * Sign-in / sign-up gate.
 *
 * One screen with a mode toggle rather than two routes: the dashboard is a
 * single app behind a single gate, and a separate signup route would need its
 * own redirect handling for no benefit.
 */
const SignIn = () => {
  const { signIn, signUp, error, setError } = useAuth();
  const [mode, setMode] = useState("signin");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [busy, setBusy] = useState(false);

  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    if (mode === "signin") await signIn(form.email, form.password);
    else await signUp(form.email, form.password, form.name);
    setBusy(false);
  };

  const swap = () => {
    setMode(mode === "signin" ? "signup" : "signin");
    setError(null);
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-head">
          <h1>TradingMitra</h1>
          <p>{mode === "signin" ? "Sign in to your account" : "Create an account"}</p>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === "signup" && (
            <label>
              <span>Name</span>
              <input
                name="name" type="text" value={form.name} onChange={change}
                autoComplete="name" placeholder="Optional"
              />
            </label>
          )}

          <label>
            <span>Email</span>
            <input
              name="email" type="email" value={form.email} onChange={change}
              autoComplete="email" required autoFocus
            />
          </label>

          <label>
            <span>Password</span>
            <input
              name="password" type="password" value={form.password} onChange={change}
              // Tells the password manager whether to offer a saved password or
              // to generate a new one.
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required minLength={mode === "signup" ? 10 : 1}
            />
            {mode === "signup" && (
              <small className="hint">
                At least 10 characters. A phrase you will remember beats a short
                password with symbols in it.
              </small>
            )}
          </label>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button type="button" className="auth-swap" onClick={swap}>
          {mode === "signin"
            ? "No account? Create one"
            : "Already have an account? Sign in"}
        </button>

        <p className="auth-note">
          New accounts start with a funded paper trading account. No real money
          is involved.
        </p>
      </div>
    </div>
  );
};

export default SignIn;
