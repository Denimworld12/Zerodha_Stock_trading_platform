import React from 'react';
function Hero() {
    return (
        <div className='container' style={{width:"1100px"}}>
            <div className='row text-center'>
                <header style={{ paddingTop: "100px", paddingBottom: "100px" }}>
                    <h1 style={{ fontSize: "44px" }}>Charges</h1>
                    <p className='text-muted' style={{ fontSize: "20px",marginTop:"20px" }}>List of all charges and taxes</p>
                </header>
                <section style={{ }}>
                    <div className='row' style={{display:"flex", justifyContent:"space-between",boxSizing:"border-box", paddingTop:"80px"}}>
                        <div className='col-4 '>
                            <img src='/media/images/pricing0.svg' style={{width:"250px"}}/>
                            <h2 className='mt-5'>Free equity delivery</h2>
                            <p className='mt-4'>All equity delivery investments (NSE, BSE), are absolutely free — ₹ 0 brokerage.</p>
                        </div>
                        <div className='col-4'>
                            <img src='media\images\other-trades.svg ' style={{width:"250px"}}/>
                            <h2 className='mt-5'>Intraday and F&O trades</h2>
                            <p className='mt-4'>Flat ₹ 20 or 0.03% (whichever is lower) per executed order on intraday trades across equity, currency, and commodity trades. Flat ₹20 on all option trades.</p>
                        </div>
                        <div className='col-4'>
                            <img src='/media/images/pricing0.svg ' style={{width:"250px"}}/>
                            <h2 className='mt-5'>Free direct MF</h2>
                            <p className='mt-4'>All direct mutual fund investments are absolutely free — ₹ 0 commissions & DP charges.</p>
                        </div>
                    </div>

                </section>
            </div>

        </div>
    );
}

export default Hero;