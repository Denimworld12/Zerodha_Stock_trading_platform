import React from 'react';
function Hero() {
    return (
        <>

            <div className='container' style={{ width: "1100px", paddingTop: "120px" }}>
                <div className='row '>
                    <h1 className='pt-5 text-center' style={{ fontSize: "34px" }}>
                        Open a free demat and trading account online
                    </h1>
                    <p className='text-center' style={{ fontSize: "18px" }}>
                        Start investing brokerage free and join a community of 1.6+ crore investors and traders
                    </p>

                    <div className='row ' style={{ display: "flex", justifyContent: "center", padding: "40px 20px 112px" }}  >
                        <div className='col-6'>
                            <img src='media\images\account_open.svg' />
                        </div>
                        <div className='col-6 my-auto' style={{padding:"28px 24px"}} >
                            <p style={{ fontSize: "24px" }} > Signup now</p>
                            <p style={{ fontSize: "16px" }}>Or track your existing application</p>
                            <div style={{ display: "flex", flexDirection: "row", justifyContent: "left" }}>
                                <div
                                    className="py-2"
                                    style={{
                                        display: "flex",
                                        flexDirection: "row",
                                        alignItems: "center",
                                        padding: "0px 12px",
                                        border: "1px solid lightgrey",
                                        borderRight: "none"  // Remove right border to merge with input
                                    }}
                                >
                                    <img
                                        src="media/images/download.svg"
                                        alt="flag"
                                        style={{ width: "24px", height: "24px" }}
                                    />
                                    <p className="px-2 my-auto" style={{ margin: 0 }}>+91</p>
                                </div>

                                <input
                                    className="phone-input "
                                    style={{
                                        padding: "16px 12px",
                                        border: "1px solid lightgrey",
                                        outline: "none",
                                        // Make input take remaining space if needed
                                    }}
                                    placeholder="Enter your mobile number"
                                />
                            </div>

                            <button style={{ backgroundColor: "#387ED1", height: "54px", width: "260px" }} className='btn btn-primary fs-5 text-center mt-4' >Get OTP</button>
                            <p className='mt-5' style={{fontSize:"14px"}}>By proceeding, you agree to the Trading-Mitra <a href='' className='text-decoration-none'>terms</a>  & <a href='' className='text-decoration-none'>privacy policy</a>  </p>
                        </div>
                    </div>

                </div>

            </div>
        </>
    );
}

export default Hero;