import React from 'react';
function Team() {
    return (
        <div className='container mt-5 ' style={{ width: "1100px", paddingBottom: "100px" }} >
            <div className='text-center mb-5'>
                <h1 className='' style={{ fontSize: "32px" }}>People</h1>
            </div>
            <div className='row  md-5  mx-auto ' style={{ lineHeight: "2", width: "900px" }}>
                <div className='col-5 text-center'  >
                    <img src='media/images/nikhil.jpg' className='mx-auto d-block' style={{ width: "295px", borderRadius: "40%" }} />
                    <h4 className="mt-3"> Nikhil Gupta </h4>
                    <h5 className='text-muted mt-3' style={{ fontSize: "14.4px" }}>Founder, CEO</h5>
                </div>
                <div className='col-7  ' style={{ fontSize: "16px" }}>
                    <p className='md-2'>
                        <strong>Nikhil</strong> is building a full-stack stock trading platform <strong>using the MERN stack</strong>, combining technology with a passion for financial markets. As 
                        a {' '}
                        <strong>Stock Analyst</strong>, he specializes in analyzing charts using candlestick patterns to make informed trading decisions.
                    </p>

                    <p>
                        He is deeply interested in market trends and trading psychology, aiming to make investing more accessible through intuitive and reliable tools.
                    </p>

                    <p>
                        Playing chess is his zen.
                    </p>


                    <p>Connect on <a href='' style={{ textDecoration: "none" }}>Homepage</a>  /<a href='' style={{ textDecoration: "none" }}>TradingQnA</a>  / <a href='' style={{ textDecoration: "none" }}>Twitter</a></p>


                </div>
            </div>

        </div>
    );
}

export default Team;