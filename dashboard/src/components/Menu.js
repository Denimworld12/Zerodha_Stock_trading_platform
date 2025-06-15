import React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";

const Menu = () => {
  const [selectedMenu, setMenu] = useState(0);
  //for the select menu tag 
  const [isProfileDropdown, setProfile] = useState(false);
  const handleMenu = (index) => (
    setMenu(index)
  )
  const handleProfile = (index) => (
    setProfile(!isProfileDropdown)
  )
  const menuClass = "menu";
  const activeMenu = "menu selected"

  return (
    <div className="menu-container">

      <img src="media\images\logo.png" style={{ width: "40px" }} />
      <div className="menus">
        <ul>
          <li>
            <Link
              style={{ textDecoration: "none" }}
              to={'/'}
              onClick={() => handleMenu(0)}>
              
              <p className={selectedMenu==0 ? activeMenu:menuClass}> Dashboard</p>
            </Link>

          </li>
          <li>
            <Link
              style={{ textDecoration: "none" }}
              to={'/'}
              onClick={() => handleMenu(1)}>
              
              <p className={selectedMenu==1 ? activeMenu:menuClass}> Orders</p>
            </Link>
          </li>
          <li>
            <Link
              style={{ textDecoration: "none" }}
              to={'/'}
              onClick={() => handleMenu(2)}>
              
              <p className={selectedMenu==2 ? activeMenu:menuClass}> Holdings</p>
            </Link>
          </li>
          <li>
            <Link
              style={{ textDecoration: "none" }}
              to={'/'}
              onClick={() => handleMenu(3)}>
              
              <p className={selectedMenu==3 ? activeMenu:menuClass}> Positions</p>
            </Link>
          </li>
          <li>
            <Link
              style={{ textDecoration: "none" }}
              to={'/'}
              onClick={() => handleMenu(4)}>
              
              <p className={selectedMenu==4 ? activeMenu:menuClass}> Bids</p>
            </Link>
          </li>
          <li>
           <Link
              style={{ textDecoration: "none" }}
              to={'/funds '}
              onClick={() => handleMenu(5)}>
              
              <p className={selectedMenu==5 ? activeMenu:menuClass}> funds</p>
            </Link>
          </li>
        </ul>
        <hr />
        <div className="profile" >

          <div className="avatar">ZU</div>
          <p className="username">DEMOUSERID</p>
        </div>
      </div>
    </div>
  );
};

export default Menu;
