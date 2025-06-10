import React from 'react';
import { Link } from 'react-router-dom';
function Navbar() {
    return (

        <nav className="navbar navbar-expand-lg  border sticky-top mx-auto" style={{ backgroundColor: "white" }}>
            <div className="container p-2" style={{ backgroundColor: "white", width: "1100px" }}>
                <div className="row">
                    <div className="col-4">
                        <Link className="navbar-brand" to="/">
                            <img src="media/images/logo.svg" style={{ width: "40%" }} />
                        </Link>
                    </div>
                    <div className="col-1">

                    </div>

                        <div className="collapse navbar-collapse d-flex col-7 " id="navbarSupportedContent">
                            <ul className="navbar-nav text-muted ms-auto d-flex justify-content-end" style={{fontSize:"14.4px", color:"rgb(128,128,128)"}} >
                                <li className="">
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
                                    <Link className="nav-link active" to="#"><i className="fa-solid fa-bars" /></Link>
                                </li>


                            </ul>

                        
                    </div>
                </div>



            </div>
        </nav>
    );
}

export default Navbar;