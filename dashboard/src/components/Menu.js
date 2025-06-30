import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
// Add optional styles here

const Menu = () => {
  const [selectedMenu, setMenu] = useState(0);
  const [isProfileDropdown, setProfile] = useState(false);
  const navigate = useNavigate();

  const isLoggedIn = !!localStorage.getItem("token");

  const handleMenu = (index) => setMenu(index);
  const toggleProfile = () => setProfile(!isProfileDropdown);

  const handleLogin = () => navigate("/signup");
  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/signup");
  };

  const menuClass = "menu";
  const activeMenu = "menu selected";

  return (
    <div className="menu-container">
      <img src="media/images/logo.png" style={{ width: "40px" }} alt="logo" />
      <div className="menus">
        <ul>
          {["Dashboard", "Orders", "Holdings", "Positions", "charts", "Funds"].map((item, idx) => (
            <li key={idx}>
              <Link
                to={item === "Dashboard" ? "/" : `/${item.toLowerCase()}`}
                onClick={() => handleMenu(idx)}
                style={{ textDecoration: "none" }}
              >
                <p className={selectedMenu === idx ? activeMenu : menuClass}>{item}</p>
              </Link>
            </li>
          ))}
        </ul>

        <hr />

        <div className="profile" onClick={toggleProfile}>
          <div className="avatar">ZU</div>
          <p className="username">DEMOUSERID</p>

          {isProfileDropdown && (
            <div className="custom-dropdown shadow-sm">
              {isLoggedIn ? (
                <button onClick={handleLogout} className="dropdown-btn">Logout</button>
              ) : (
                <button onClick={handleLogin} className="dropdown-btn">Login</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Menu;
