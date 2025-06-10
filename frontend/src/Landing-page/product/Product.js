import React from 'react';
import LeftSection from './LeftSection';
import Hero from './Hero';
import RightSection from './RightSection';
import Universe from './Universe';
function Product() {

    return (
        <>
            <Hero />

            <LeftSection
                imgurl="media\images\kite.png"
                Productheadline="Kite"
                Productdescription="Our ultra-fast flagship trading platform with streaming market data, advanced charts, an elegant UI, and more. Enjoy the Kite experience seamlessly on your Android and iOS devices."
                tryDemo="Try demo "
                learnMore="Learn more "
                googlePlay="https://play.google.com/store/apps/details?id=com.zerodha.kite3&pli=1"
                appStore="https://apps.apple.com/in/app/zerodha-kite-trade-invest/id1449453802"

            />
            <RightSection
                imgurl="media\images\console.png"
                Productheadline="Console"
                Productdescription="The central dashboard for your Zerodha account. Gain insights into your trades and investments with in-depth reports and visualisations."
                tryDemo="Learn more"

            />
            <LeftSection
                imgurl="media\images\coin.png"
                Productheadline="Coin"
                Productdescription="Buy direct mutual funds online, commission-free, delivered directly to your Demat account. Enjoy the investment experience on your Android and iOS devices."
                tryDemo="Coin "
                learnMore=""
                googlePlay=" "
                appStore=" "
            />
            <RightSection
                imgurl="media\images\kiteconnect.png"
                Productheadline="Kite Connect API
"
                Productdescription="Build powerful trading platforms and experiences with our super simple HTTP/JSON APIs. If you are a startup, build your investment app and showcase it to our clientbase."
                tryDemo="Kite Connect "

            />
            <LeftSection
                imgurl="media\images\varsity.png"
                Productheadline="Varsity mobile
"
                Productdescription="An easy to grasp, collection of stock market lessons with in-depth coverage and illustrations. Content is broken down into bite-size cards to help you learn on the go."
                tryDemo=""
                learnMore=""
                googlePlay=""
                appStore=""
            />
            <div className='container text-center' style={{width:"1100px"}}>
                <div className='row'>
                    <p className='fs-5' style={{ paddingTop: "80px" }}>
                        Want to know more about our technology stack? Check out the Zerodha.tech blog.
                    </p>
                </div>

            </div>


            <Universe />
        </>
    );
}

export default Product;