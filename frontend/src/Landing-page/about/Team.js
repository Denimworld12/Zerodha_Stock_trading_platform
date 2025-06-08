import React from 'react';
function Team() {
    return (
        <div className='container  '>
            <div className='row text-center fs-5'>
                <h1 className=''>People</h1>
            </div>
            <div className='row p-5 md-5  mx-auto ' style={{ lineHeight: "2", width: "900px" }}>
                <div className='col-5 text-center'  >
                    <img src='media/images/nithinKamath.jpg' className='mx-auto d-block' style={{ width: "80%", borderRadius: "100%" }} />
                    <h4>Nithin Kamath</h4>
                    <h5 className='text-muted' style={{ fontSize: "14.4px" }}>Founder, CEO</h5>
                </div>
                <div className='col-7  ' style={{ fontSize: "16px" }}>
                    <p className='md-2'> Nithin bootstrapped and founded Zerodha in 2010 to overcome the hurdles he faced during his decade long stint as a trader. Today, Zerodha has changed the landscape of the Indian broking industry.</p>

                    <p>He is a member of the SEBI Secondary Market Advisory Committee (SMAC) and the Market Data Advisory Committee (MDAC).</p>

                    <p>  Playing basketball is his zen.</p>

                    <p>Connect on <a href='' style={{ textDecoration: "none" }}>Homepage</a>  /<a href='' style={{ textDecoration: "none" }}>TradingQnA</a>  / <a href='' style={{ textDecoration: "none" }}>Twitter</a></p>


                </div>
            </div>

        </div>
    );
}

export default Team;