import React from 'react';
function Hero() {
    return (
        <div className='container border-bottom md-5' style={{paddingTop:"100px",paddingBottom:"100px" ,width:"1200px"}}>
            <div className='row text-center' style={{lineHeight:"1.75"}}>
                <h1 className='' style={{fontSize:"44px"}}>Zerodha Products</h1>
                <div className='text-muted fs-5 mb-3 '>Sleek, modern, and intuitive trading platformsx</div>
                <div className='fs-8 '>
                    Check out our<a href='#' className='text-decoration-none fw-medium'> investment offerings <i className="fa-solid fa-arrow-right"></i></a>
                </div>


            </div>
        </div>
    );
}

export default Hero;