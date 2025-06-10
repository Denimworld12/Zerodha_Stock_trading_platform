import React from 'react';
function LeftSection({
    imgurl,
    Productheadline,
    Productdescription,
    tryDemo,
    learnMore,
    googlePlay,
    appStore,
}
) {
    return (
        <div className='container p-5 mb-5 ' style={{ width: "1100px" ,paddingTop:"80px"}}>
            <div className='row ' style={{display:"flex"}} >
                <div className='col-8' >
                    <img src={imgurl}></img>
                </div>
                <div className='col-4 ' style={{display:"flex", justifyContent:"center",flexDirection:"column"}} >
                    <h2 className=''>{Productheadline}</h2>
                    <p>{Productdescription}</p>
                    <div className='row'>
                        <div className='col ' >
                            {
                                tryDemo && (
                                    <a href='' className='text-decoration-none'>
                                        {tryDemo}
                                        <i className="fa-solid fa-arrow-right"></i>
                                    </a>
                                )
                            }
                        </div>
                        <div className='col'>
                            {
                                learnMore && (
                                    <a href='' className='text-decoration-none'>
                                        {learnMore}
                                        <i className="fa-solid fa-arrow-right"></i>
                                    </a>
                                )}
                        </div>

                    </div>
                    <div className='row'>
                        <div className='col ' >
                            <a href={googlePlay}><img className='mt-3' src="media\images\googlePlayBadge.svg" alt="playstore" /></a>
                        </div>
                        <div className='col'>
                            <a href={appStore}><img className='mt-3' src="media/images/appstoreBadge.svg" alt='appstore' /></a>
                        </div>


                    </div>
                </div>
            </div>
        </div>
    );
}

export default LeftSection;