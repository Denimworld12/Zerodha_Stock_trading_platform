import React from 'react';
import './universe.css'
function Universe() {
    // const universeItems = [
    //     {
    //         imgSrc: 'media/images/zerodhaFundhouse.png',
    //         text: 'Our asset management venture that is creating simple and transparent index funds to help you save for your goals.',
    //     },
    //     {
    //         imgSrc: 'media/images/sensibullLogo.svg', // put your actual image here
    //         text: 'Options trading platform that lets you create strategies, analyze positions, and examine data points like open interest, FII/DII, and more.',
    //     },
    //     {
    //         imgSrc: 'media/images/tijori.svg', // put your actual image here
    //         text: 'Investment research platform that offers detailed insights on stocks, sectors, supply chains, and more.',
    //     },
    //     {
    //         imgSrc: 'media/images/streakLogo.png', // put your actual image here
    //         text: 'Systematic trading platform that allows you to create and backtest strategies without coding.',
    //     },
    //     {
    //         imgSrc: 'media/images/smallcaseLogo.png', // put your actual image here
    //         text: 'Thematic investing platform that helps you invest in diversified baskets of stocks on ETFs.',
    //     },
    //     {
    //         imgSrc: 'media/images/dittoLogo.png', // put your actual image here
    //         text: 'Personalized advice on life and health insurance. No spam and no mis-selling.',
    //     },
    // ];

    return (
        <div className='container ' style={{ width: "1100px", paddingTop: "80px", paddingBottom: "80    px" }}>
            <div className='row text-center'>
                <h2>The Zerodha Universe</h2>
                <p className=''>Extend your trading and investment experience even further with our partner platforms</p>
                <div className='row mt-5' >

                    <div className='row sabkuch' style={{ display: "flex", justifyContent: "space-evenly" }}>
                        <div className='col-4 mb-5' style={{ fontSize: "12px" }}>
                            <img src='media/images/zerodhaFundhouse.png ' style={{ height: "55px", marginBottom: "20px" }} alt='universe-item-0' />
                            <br />
                            <span className='text-muted ' style={{ height: "54px", lineHeight: "18px", marginTop: "10px" }}>
                                Our asset management venture
                                <br />that is creating simple and transparent index
                                <br />funds to help you save for your goals.
                            </span>
                        </div>
                        <div className='col-4 mb-4' style={{ fontSize: "12px", marginBottom: "20px" }}>
                            <img src='media/images/sensibullLogo.svg' style={{ height: "40px", marginBottom: "35px" }} alt='universe-item-1' />
                            <br />
                            <span className='text-small text-muted' style={{}}>
                                Options trading platform that lets you<br /> create strategies, analyze positions, and examine <br />data points like open interest, FII/DII, and more.
                            </span>
                        </div>
                        <div className='col-4 mb-4' style={{ fontSize: "12px" }}>
                            <img src='media/images/tijori.svg' style={{ height: "55px", marginBottom: "20px" }} alt='universe-item-2' />
                            <br />
                            <span className='text-small text-muted' style={{}}>
                                Investment research platform <br />that offers detailed insights on stocks,<br /> sectors, supply chains, and more.
                            </span>
                        </div>
                        <div className='col-4 mb-4' style={{ fontSize: "12px" }}>
                            <img src='media/images/streakLogo.png' style={{ height: "55px", marginBottom: "20px" }} alt='universe-item-3' />
                            <br />
                            <span className='text-small text-muted' style={{}}>
                                Systematic trading platform <br />
                                that allows you to create and backtest <br />
                                strategies without coding.
                            </span>
                        </div>



                        <div className='col-4 mb-4' style={{ fontSize: "12px" }}>
                            <img src='media/images/smallcaseLogo.png' style={{ height: "55px", marginBottom: "20px" }} alt='universe-item-4' />
                            <br />
                            <span className='text-small text-muted' style={{}}>
                                Thematic investing platform <br />
                                that helps you invest in diversified <br />
                                baskets of stocks on ETFs.
                            </span>
                        </div>



                        <div className='col-4 mb-5' style={{ fontSize: "12px" }}>
                            <img src='media/images/dittoLogo.png' style={{ height: "55px", marginBottom: "20px" }} alt='universe-item-5' />
                            <br />
                            <span className='text-small text-muted' style={{}}>
                                Personalized advice on life<br /> and health insurance. No spam <br />and no mis-selling.
                            </span>
                        </div>
                    </div>



                </div>
                <button style={{ backgroundColor: "#387ED1", width: "16%", height: "", margin: "0 auto", marginTop:"10px    "}} className='p-1 btn btn-primary fs-5 mb-5' >Sign up for Free</button>

            </div>
        </div>
    );
}

export default Universe;