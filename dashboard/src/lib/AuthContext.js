import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "./api";

/**
 * Session state for the dashboard.
 *
 * `booting` exists so the app can tell "we have not checked yet" apart from
 * "definitely signed out". Without it the login screen flashes on every reload
 * before the refresh cookie is exchanged, which looks like being logged out at
 * random.
 */

const AuthContext = createContext(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.restoreSession().then((restored) => {
      if (cancelled) return;
      setUser(restored);
      setBooting(false);
    });

    // If a refresh fails later (revoked session, expired refresh token), the
    // API client clears the token. Reflect that here so the UI does not sit
    // pretending to be signed in while every request 401s.
    const off = api.onAuthChange((token) => {
      if (!token) setUser(null);
    });
    return () => { cancelled = true; off(); };
  }, []);

  const signIn = useCallback(async (email, password) => {
    setError(null);
    try {
      setUser(await api.login(email, password));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, []);

  const signUp = useCallback(async (email, password, name) => {
    setError(null);
    try {
      setUser(await api.register(email, password, name));
      return true;
    } catch (err) {
      // Password rules come back as a list; showing them all is more useful
      // than "invalid password".
      setError(err.issues?.length ? err.issues.join("; ") : err.message);
      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, booting, error, signIn, signUp, signOut, setError }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
