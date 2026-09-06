import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

const ITEMS = [
  ["Dashboard", "/"],
  ["Orders", "/orders"],
  ["Holdings", "/holdings"],
  ["Positions", "/positions"],
  ["Charts", "/charts"],
  ["Funds", "/funds"],
  ["Signals", "/signals"],
];

const Menu = () => {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  // Highlight from the URL rather than from click state, so a refresh or a
  // direct link still shows the right tab selected.
  const { pathname } = useLocation();

  const initials = (user?.name || user?.email || "?")
    .split(/[\s@.]/).filter(Boolean).slice(0, 2)
    .map((s) => s[0].toUpperCase()).join("");

  return (
    <div className="menu-container">
      <img src="media/images/logo.png" style={{ width: "40px" }} alt="logo" />

      <div className="menus">
        <ul>
          {ITEMS.map(([label, path]) => (
            <li key={path}>
              <Link
                to={path}
                style={{ textDecoration: "none" }}
                className={pathname === path ? "menu selected" : "menu"}
              >
                <p>{label}</p>
              </Link>
            </li>
          ))}
        </ul>

        <hr />

        <div className="profile" style={{ position: "relative" }}>
          <div
            className="avatar"
            onClick={() => setOpen(!open)}
            style={{ cursor: "pointer" }}
            title={user?.email}
          >
            {initials}
          </div>
          <p className="username">{user?.name || user?.email?.split("@")[0]}</p>

          {open && (
            <div style={{
              position: "absolute", right: 0, top: "115%", zIndex: 50,
              background: "#fff", border: "1px solid #dde1e6", borderRadius: 6,
              boxShadow: "0 8px 24px -12px rgba(20,24,29,.3)",
              minWidth: "12rem", padding: ".4rem", fontSize: ".85rem",
            }}>
              <div style={{ padding: ".45rem .6rem", color: "#6b7280", borderBottom: "1px solid #eef1f4" }}>
                {user?.email}
              </div>
              <button
                onClick={signOut}
                style={{
                  width: "100%", textAlign: "left", padding: ".5rem .6rem",
                  background: "none", border: "none", cursor: "pointer",
                  color: "#b91c1c", fontSize: ".85rem", fontFamily: "inherit",
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Menu;
