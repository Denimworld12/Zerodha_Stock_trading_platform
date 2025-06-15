import React from "react";
function Footer() {
  return (
    <footer className="border-top " style={{ backgroundColor: "#FBFBFB", paddingTop: "50px" }}>
      <div className="container md-5 " style={{ width: "1100px " }}>
        <div className="row">
          <div className="col-3">
            <img src="media/images/image.png" className="mb-3" style={{ width: "60%" }} />
            <p style={{ marginBottom: "20px", fontSize: "12.8px" }} className="mb-3">
              &copy; 2010 - 2025, Trading-Mitra Broking Ltd. All rights reserved.
            </p>

            {/* First Row of Social Icons */}
            <div className="d-flex gap-4 align-items-center border-bottom pb-3">
              <a href="#"><i className="fab fa-x-twitter fa-lg text-muted"></i></a>
              <a href="#"><i className="fab fa-facebook fa-lg text-muted"></i></a>
              <a href="#"><i className="fab fa-instagram fa-lg text-muted"></i></a>
              <a href="#"><i className="fab fa-linkedin fa-lg text-muted"></i></a>
            </div>

            {/* Second Row of Social Icons */}
            <div className="d-flex gap-4 align-items-center mt-3">
              <a href="#"><i className="fab fa-youtube fa-lg text-muted"></i></a>
              <a href="#"><i className="fab fa-whatsapp fa-lg text-muted"></i></a>
              <a href="#"><i className="fab fa-telegram fa-lg text-muted"></i></a>
            </div>
          </div>

          <div className="col-9" style={{ display: "flex", flexWrap: "wrap", flexDirection: "row", }}>
            <div className="col" style={{ margin: "auto" }}>
              <h5 style={{ marginBottom: "20px", fontSize: "18px" }}>Account</h5>
              <ul className="list-unstyled">
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Open demat account</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Minor demat account</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>NRI demat account</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Commodity</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Dematerialisation</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Fund</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Transfer</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>MTF</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Referral Program</a></li>
              </ul>
            </div>

            <div className="col">
              <h5 style={{ marginBottom: "20px", fontSize: "18px" }}>Support</h5>
              <ul className="list-unstyled">
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Contact us</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Support portal</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>How to file a complaint?</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Status of your complaints</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Bulletin</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Circular</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Z-Connect blog</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Downloads</a></li>
              </ul>
            </div>

            <div className="col">
              <h5 style={{ marginBottom: "20px", fontSize: "18px" }}>Company</h5>
              <ul className="list-unstyled">
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>About</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Philosophy</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Press & media</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Careers</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Trading-Mitra Cares (CSR)</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Trading-Mitra.tech</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Open source</a></li>
              </ul>
            </div>

            <div className="col">
              <h5 style={{ marginBottom: "20px", fontSize: "18px" }}>Quick links</h5>
              <ul className="list-unstyled">
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Upcoming IPOs</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Brokerage charges</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Market holidays</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Economic calendar</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Calculators</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Markets</a></li>
                <li><a href="#" className="text-muted text-decoration-none d-block mb-2" style={{ fontSize: "14px" }}>Sectors</a></li>
              </ul>
            </div>
          </div>


        </div>
        <div className="md-5 mt-5 text-muted" style={{ fontSize: "10px", color: "#9B9B9B", lineHeight: "1.8" }}>
          <p>
            Trading-Mitra Broking Ltd.: Member of NSE, BSE​ &​ MCX – SEBI Registration
            no.: INZ000031633 CDSL/NSDL: Depository services through Trading-Mitra
            Broking Ltd. – SEBI Registration no.: IN-DP-431-2019 Commodity
            Trading through Trading-Mitra Commodities Pvt. Ltd. MCX: 46025; NSE-50001
            – SEBI Registration no.: INZ000038238 Registered Address: Trading-Mitra
            Broking Ltd., #153/154, 4th Cross, Dollars Colony, Opp. Clarence
            Public School, J.P Nagar 4th Phase, Bengaluru - 560078, Karnataka,
            India. For any complaints pertaining to securities broking please
            write to <a className="text-decoration-none" href="">complaints@Trading-Mitra.com
            </a>, for DP related to <a className="text-decoration-none" href="">dp@Trading-Mitra.com
            </a>.
            Please ensure you carefully read the Risk Disclosure Document as
            prescribed by SEBI | ICF{" "}
          </p>
          <p>
            Procedure to file a complaint on SEBI SCORES: Register on SCORES
            portal. Mandatory details for filing complaints on SCORES: Name,
            PAN, Address, Mobile Number, E-mail ID. Benefits: Effective
            Communication, Speedy redressal of the grievances{" "}
          </p>
          <p>
            <a className="text-decoration-none" href="">Smart Online Dispute Resolution
            </a>  | <a className="text-decoration-none" href="">Grievances Redressal Mechanism{" "}
            </a>
          </p>
          <p>
            Investments in securities market are subject to market risks; read
            all the related documents carefully before investing.
          </p>{" "}
          <p>
            {" "}
            Attention investors: 1) Stock brokers can accept securities as
            margins from clients only by way of pledge in the depository system
            w.e.f September 01, 2020. 2) Update your e-mail and phone number
            with your stock broker / depository participant and receive OTP
            directly from depository on your e-mail and/or mobile number to
            create pledge. 3) Check your securities / MF / bonds in the
            consolidated account statement issued by NSDL/CDSL every month.{" "}
          </p>
          <p>
            "Prevent unauthorised transactions in your account. Update your
            mobile numbers/email IDs with your stock brokers. Receive
            information of your transactions directly from Exchange on your
            mobile/email at the end of the day. Issued in the interest of
            investors. KYC is one time exercise while dealing in securities
            markets - once KYC is done through a SEBI registered intermediary
            (broker, DP, Mutual Fund etc.), you need not undergo the same
            process again when you approach another intermediary." Dear
            Investor, if you are subscribing to an IPO, there is no need to
            issue a cheque. Please write the Bank account number and sign the
            IPO application form to authorize your bank to make payment in case
            of allotment. In case of non allotment the funds will remain in your
            bank account. As a business we don't give stock tips, and have not
            authorized anyone to trade on behalf of others. If you find anyone
            claiming to be part of Trading-Mitra and offering such services, please
            <a className="text-decoration-none" href="">create a ticket here</a>.
          </p>
        </div>
        <div
          className="m-3 text-center"
          style={{ fontSize: "12px", whiteSpace: "nowrap", marginLeft: "-20px", fontWeight: "600" }}
        >
          <a href="#" className="me-3 text-decoration-none text-muted">NSE</a>
          <a href="#" className="me-3 text-decoration-none text-muted">BSE</a>
          <a href="#" className="me-3 text-decoration-none text-muted">MCX</a>
          <a href="#" className="me-3 text-decoration-none text-muted">Terms & conditions</a>
          <a href="#" className="me-3 text-decoration-none text-muted">Policies & procedures</a>
          <a href="#" className="me-3 text-decoration-none text-muted">Privacy policy</a>
          <a href="#" className="me-3 text-decoration-none text-muted">Disclosure</a>
          <a href="#" className="me-3 text-decoration-none text-muted">For investor's attention</a>
          <a href="#" className="text-decoration-none text-muted">Investor charter</a>
        </div>

      </div>
    </footer>
  );
}

export default Footer;
