import React from 'react';
function Awards() {
  return (
    <div className='container p-5 mb-5'>
      <div className='row'>
        <div className='col-5 p-5'>
          <h2 className='mb-5 fs-2'>Trust with confidence</h2>
          <h3 className='fs-4 '>Customer-first always</h3>
          <p className='text-muted '>
            That's why 1.6+ crore customers trust Zerodha with ~ ₹6 lakh crores of equity investments and contribute to 15% of daily retail exchange volumes in India.
          </p>
          <h3 className='fs-4 ' >No spam or gimmicks</h3>
          <p className='text-muted '>
            No gimmicks, spam, "gamification", or annoying push notifications. High quality apps that you use at your pace, the way you like. Our philosophies.
          </p>
          <h3 className='fs-4 '>The Zerodha universe</h3>
          <p className='text-muted '>
            Not just an app, but a whole ecosystem. Our investments in 30+ fintech startups offer you tailored services specific to your needs.
          </p>
          <h3 className='fs-4 '>Do better with money</h3>
          <p className='text-muted '>
            With initiatives like Nudge and Kill Switch, we don't just facilitate transactions, but actively help you do better with your money.
          </p>

        </div>
        <div className='col-7 p-3 '>
          <img src='media/images/ecosystem.png'  style={{width:"80%"}}></img>
          <div className='d-flex justify-content-evenly	' >
            {/* <div className='col-6 '> */}
              <a href='#' className='text-decoration-none'>Explore our products <i className="fa-solid fa-arrow-right"></i></a>
            {/* </div> */}
            {/* <div className='col-6' > */}
              <a href='#' className='text-decoration-none'>Try Kite demo <i className="fa-solid fa-arrow-right"></i></a>
            {/* </div> */}
          </div>

        </div>
        <img src='media/images/pressLogos.png' className='d-block mx-auto' style={{ width: "60%" }} alt="Press Logos" />
      </div>
    </div>
  );
}

export default Awards;