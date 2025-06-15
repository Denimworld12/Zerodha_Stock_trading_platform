import React from 'react';
function Hero() {
    return (
        <div style={{ paddingTop: "20px", paddingBottom: "85px", background: "#387ED1", color: "#0000" }}>
            <div className='container ' style={{ width: "1100px" }}>
                <div className='row  '>
                    <div className='d-flex justify-content-between align-items-center p-0 mb-4' style={{ height: "84px", fontWeight: "500" }}>
                        <a className='text-decoration-none fs-5 text-white justify-content-center' href=''>Support Portal</a>
                        <a className='text-white text-decoration-none border-bottom' href=''>Track tickets</a>


                    </div>
                    <div className='col-7 p-0'>
                        <div className='text-white mb-4' style={{ fontSize: "22px" }}>
                            Search for an answer or browse help topics to create a <br />ticket
                        </div>
                        <div className='bg-white' style={{ display: "flex", alignItems: "center", width: "90%", marginBottom: "10px", border: "1px solid #ccc", borderRadius: "4px", paddingRight: "15px" }}>
                            <input
                                placeholder='Eg: how do I activate F&O, why is my order getting rejected ...'
                                style={{ height: "58px", padding: "20px", width: "100%", border: "none", outline: "none" }}
                            />
                            <i className="fa-solid fa-magnifying-glass bg-white " style={{ fontSize: "20px", cursor: "pointer", color: "#555" }}></i>
                        </div>

                        {/* <input id="search-text" type="text" class="form-control typeahead" autocomplete="off" placeholder="Eg: how do i activate F&amp;O, why is my order getting rejected ..." autofocus=""></input> */}
                        <div className='' style={{ display: "flex", flexDirection: "row", width: "auto", flexWrap: "wrap" }}>
                            <p>  <a className='text-white text-decoration-none border-bottom p-2 ps-0 ' href='' style={{ margin: "0px 20px 10px 0px" }}>Track account opening</a></p>
                            <p> <a className='text-white text-decoration-none border-bottom p-2 ps-0' href='' style={{ margin: "0px 20px 15px 0px" }}>Track segment activation</a></p>
                            <p> <a className='text-white text-decoration-none border-bottom p-2 ps-0' href='' style={{ margin: "0px 20px 15px 0px" }}>Intraday margins</a><br /></p>
                            <p> <a className='text-white text-decoration-none border-bottom p-2 ps-0' href='' style={{ margin: "12px 20px 15px 0px" }}> Kite user manual</a></p>

                        </div>

                    </div>

                    <div className='col-5 text-white' style={{display:"flex" , justifyContent:"center", flexDirection:""}}>
                        <div className='text-white mb-4' style={{ fontSize: "22px" }}>
                            Featured
                        </div>
                        <ol>
                            <li className='mb-3'><a className='text-white ' href=''>Adjustment of F&O contracts of BAJFINANCE on account of bonus and split</a></li>
                            <li><a className='text-white' href=''>Surveillance measure on scrips - June 2025</a> </li>
                        </ol>



                    </div>
                </div>
            </div>
        </div>
    );
}

export default Hero;