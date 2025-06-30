import React from 'react';

function RightSection({
    imgurl,
    Productheadline,
    Productdescription,
    tryDemo,

}
) {
    return (
        <div className='container mb-5 ' style={{ width: "1100px" ,paddingTop:"80px"}}>
            <div className='row'>

                <div className='col-4 mt-5 mb-3' style={{display:"flex", justifyContent:"center",flexDirection:"column"}}>
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


                    </div>

                </div>
                <div className='col-8'>
                    <img src={imgurl}></img>
                </div>
            </div>
        </div>
    );
}


export default RightSection;