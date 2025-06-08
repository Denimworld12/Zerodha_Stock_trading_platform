import React from 'react';
import { Link } from 'react-router-dom';
function Navbar() {
    return (
        
            <nav className="navbar navbar-expand-lg  border sticky-top" style={{ backgroundColor: "white" }}>
                <div className="container p-2">
                    <Link className="navbar-brand" to="/">
                        <img src="media/images/logo.svg" style={{ width: "20%",marginLeft:"40px" }} />
                    </Link>

                    <div className="collapse navbar-collapse" id="navbarSupportedContent">
                        <ul className="navbar-nav me-auto mb-2 mb-lg-0">
                            <li className="nav-item">
                                <Link className="nav-link active" aria-current="page" to="/signup">Signup</Link>
                            </li>
                            <li className="nav-item ">
                                <Link className="nav-link active" to="/about">About</Link>
                            </li>
                            <li className="nav-item">
                                <Link className="nav-link active" aria-current="page" to="/products">Products</Link>
                            </li>
                            <li className="nav-item">
                                <Link className="nav-link active" to="/pricing">Pricing</Link>
                            </li>
                            <li className="nav-item">
                                <Link className="nav-link active" to="/support">Support</Link>
                            </li>
                            <li className="nav-item">
                                <Link className="nav-link active" to="#"><i className="fa-solid fa-bars"/></Link>
                            </li>


                        </ul>

                    </div>
                </div>
            </nav>
    );
}

export default Navbar;