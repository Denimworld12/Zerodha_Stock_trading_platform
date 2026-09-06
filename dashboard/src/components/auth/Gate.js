import React from "react";
import { useAuth } from "../../lib/AuthContext";
import SignIn from "./SignIn";

/**
 * Renders children only for a signed-in user.
 *
 * The `booting` branch matters: without it the sign-in form flashes on every
 * page load while the refresh cookie is being exchanged, which reads as being
 * randomly logged out.
 */
const Gate = ({ children }) => {
  const { user, booting } = useAuth();

  if (booting) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", color: "#8b95a1",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: ".9rem",
      }}>
        Restoring your session…
      </div>
    );
  }

  return user ? children : <SignIn />;
};

export default Gate;
