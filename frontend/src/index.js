import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Homepage from './Landing-page/home/Homepage';
import Navbar from './Landing-page/Navbar';
import Footer from './Landing-page/Footer';
import Pricing from './Landing-page/home/Pricing';
import Signup from './Landing-page/singup/Signup'
import Products from './Landing-page/product/Product'
import AboutPage from './Landing-page/about/AboutPage'
import Support from './Landing-page/support/SupportPage'
import PageNotFound from './Landing-page/PageNotFound';




const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <Navbar />
    
    <Routes>
      <Route path='/' element={<Homepage />} />
      <Route path='/support' element={<Support/>} />
      <Route path='/signup' element={<Signup/>} />
      <Route path='/about' element={<AboutPage/>} />
      <Route path='/products' element={<Products />} />
      <Route path='/pricing' element={<Pricing />} />
      <Route path='*' element={<PageNotFound />} />
    
    </Routes>
    <Footer />
  </BrowserRouter>


);