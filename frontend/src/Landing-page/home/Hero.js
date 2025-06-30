import React from 'react';
function Hero() {
    return (
        <div className='container' style={{width:"1100px",paddingBottom:"120px", paddingTop:"120px"}} >
            <div className='row text-center'>
<img src='media/images/homeHero.png' alt='Hero Image' className='d-block mx-auto mb-5' style={{width:"80%"}} />
                <h1 className='mt-5 fs-1'>Invest in everything</h1>
                <p className='fs-4'>
                    Online platform to invest in stocks, derivatives, mutual funds, ETFs, bonds, and more.
                </p>
                <button style={{backgroundColor:"#387ED1",width:"16%", height:"", margin:"0 auto"} } className='p-1 btn btn-primary fs-5 mb-5' >Sign up for Free</button>
            </div>
        </div>
    );
}

export default Hero;