import React from 'react';
import './pricing.css'
function Pricing() {
    return (
        <div className='container p-5 md-5'>
            <div className='row ps-5'>
                <h2 className="fs-2">Unbeatable pricing</h2>
                <div className="col-5">

                    <p className='text-muted ' >We pioneered the concept of discount broking and price transparency in India. Flat fees and no hidden charges.</p>

                </div>

                <div className="col-7  ">
                    <div className='row card_1 '>
                        <div className='col-3 box '>

                            <img src='media/images/pricing0.svg' className='row_img'></img>
                            <div className='paragraph'>Free account opening</div>

                        </div>

                        <div className='col-6 box' >
                            <img src='media/images/pricing0.svg' className='row_img'></img>
                            <div className='paragraph-2'>Free equity delivery and direct mutual funds</div>
                        </div>
                        <div className='col-3 box' >
                            <img src='media/images/intradayTrades.svg' className='row_img'></img>
                            <div className='paragraph-3'>Intraday and F&O</div>
                        </div>
                    </div>


                </div>
                <a href='#' className='text-decoration-none'>See pricing <i className="fa-solid fa-arrow-right"></i></a>

            </div>

        </div>
    );
}

export default Pricing;