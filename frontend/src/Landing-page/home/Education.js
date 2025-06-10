import React from 'react';
function Education() {
    return (
        <div className='container ' style={{width:"1100px",paddingBottom:"120px"}}>
            <div className='row'>
                <div className='col-5'>
                    <img src='media/images/education.svg' style={{width:"90%"}} />
                </div>
                <div className='col-1'></div>
                <div className='col-6 '>
                    <h2 className='fs-2 mt-3'>Free and open market education</h2>
                    <p className='mb-4 mt-4 text-muted'>Varsity, the largest online stock market education book in the world covering everything from the basics to advanced trading.</p>
                    <a href='#' className='text-decoration-none '>Varsity  <i className="fa-solid fa-arrow-right"></i></a>

                    <p className='mb-4 mt-4'>TradingQ&A, the most active trading and investment community in India for all your market related queries.</p>
                    <a href='#' className='text-decoration-none '>TradingQ&A <i className="fa-solid fa-arrow-right"></i></a>

                </div>
            </div>
        </div>
    );
}

export default Education;