import React from 'react';
function Awards() {
  return (
    <div className='container mt-5 ' style={{width:"1100px",paddingBottom:"120px"}}>
      <div className='row'>
        <div className='col-5 '>
          <h2 className='mb-5 fs-2'>Trust with confidence</h2>
          <h3 className='fs-5 '>Customer-first always</h3>
          <p className='text-muted mb-5'>
            That's why 1.6+ crore customers trust Trading-Mitra with ~ ₹6 lakh crores of equity investments and contribute to 15% of daily retail exchange volumes in India.
          </p>
          <h3 className='fs-5 ' >No spam or gimmicks</h3>
          <p className='text-muted mb-5'>
            No gimmicks, spam, "gamification", or annoying push notifications. High quality apps that you use at your pace, the way you like. Our philosophies.
          </p>
          <h3 className='fs-5 '>The Trading-Mitra universe</h3>
          <p className='text-muted mb-5'>
            Not just an app, but a whole ecosystem. Our investments in 30+ fintech startups offer you tailored services specific to your needs.
          </p>
          <h3 className='fs-5 '>Do better with money</h3>
          <p className='text-muted mb-5 '>
            With initiatives like Nudge and Kill Switch, we don't just facilitate transactions, but actively help you do better with your money.
          </p>

        </div>
        <div className='col-7'>
          <img src='media/images/ecosystem.png'  style={{width:"100%"}}></img>
          <div className='d-flex justify-content-evenly	' >
            {/* <div className='col-6 '> */}
              <a href='#' className='text-decoration-none'>Explore our products <i className="fa-solid fa-arrow-right"></i></a>
            {/* </div> */}
            {/* <div className='col-6' > */}
              <a href='#' className='text-decoration-none'>Try Kite demo <i className="fa-solid fa-arrow-right"></i></a>
            {/* </div> */}
          </div>

        </div>
      </div>       
       <img src='media/images/pressLogos.png' className='d-block mx-auto' style={{ width: "60%" }} alt="Press Logos" />

    </div>
  );
}

export default Awards;