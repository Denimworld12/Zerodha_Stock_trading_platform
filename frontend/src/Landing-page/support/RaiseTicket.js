import React from 'react';

function RaiseTicket() {
    return (
        <div className='container mb-5' style={{ width: "1100px", paddingTop: "20px" }}>
            <div className='row'>
                <h2 className='text-muted fs-5 pb-5'>
                    To create a ticket, select a relevant topic
                </h2>

                <div className='col-4'>
                    <h3 style={{ fontSize: "18px", margin: "20px 0" }}>
                        <div> <i className="fa-solid fa-circle-plus" style={{ height: "18px", width: "18px" }}></i> Account Opening</div>
                    </h3>
                    <div style={{ marginLeft: "30px", fontSize: "14px" }}>
                        <div style={{ margin: "10px 0" }}><a href='' className='text-decoration-none'>Resident individual</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Minor</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Non Resident Indian (NRI)</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Company, Partnership, HUF and LLP</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Glossary</a></div>
                    </div>
                </div>

                <div className='col-4'>
                    <h3 style={{ fontSize: "18px", margin: "20px 0" }}>
                        <div><i  className="fa-regular fa-user" style={{ height: "18px", width: "18px" }}></i> Your Trading-Mitra Account</div>
                    </h3>
                    <div style={{ marginLeft: "30px", fontSize: "14px" }}>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Your Profile</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Account modification</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Client Master Report (CMR) and Depository Participant (DP)</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Nomination</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Transfer and conversion of securities</a></div>
                    </div>
                </div>

                <div className='col-4'>
                    <h3 style={{ fontSize: "18px", margin: "20px 0" }}>
                        <div><i  className="fa-solid fa-chart-simple" style={{ height: "18px", width: "18px" }}></i> Kite</div>
                    </h3>
                    <div style={{ marginLeft: "30px", fontSize: "14px" }}>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>IPO</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Trading FAQs</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Margin Trading Facility (MTF) and Margins</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Charts and orders</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Alerts and Nudges</a></div>
                    </div>
                </div>

                <div className='col-4'>
                    <h3 style={{ fontSize: "18px", margin: "20px 0" }}>
                        <div><i className="fa-solid fa-credit-card" style={{ height: "18px", width: "18px" }}></i> Funds</div>
                    </h3>
                    <div style={{ marginLeft: "30px", fontSize: "14px" }}>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Add money</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Withdraw money</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Add bank accounts</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>eMandates</a></div>
                    </div>
                </div>

                <div className='col-4'>
                    <h3 style={{ fontSize: "18px", margin: "20px 0" }}>
                        <div><i className="fa-solid fa-desktop" style={{ height: "18px", width: "18px" }}></i> Console</div>
                    </h3>
                    <div style={{ marginLeft: "30px", fontSize: "14px" }}>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Portfolio</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Corporate actions</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Funds statement</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Reports</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Profile</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Segments</a></div>
                    </div>
                </div>

                <div className='col-4'>
                    <h3 style={{ fontSize: "18px", margin: "20px 0" }}>
                        <div><i className="fa-solid fa-coins" style={{ height: "18px", width: "18px" }}></i> Coin</div>
                    </h3>
                    <div style={{ marginLeft: "30px", fontSize: "14px" }}>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Mutual funds</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>National Pension Scheme (NPS)</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Features on Coin</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>Payments and Orders</a></div>
                        <div style={{ margin: "10px 0" }}><a className='text-decoration-none'>General</a></div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default RaiseTicket;
