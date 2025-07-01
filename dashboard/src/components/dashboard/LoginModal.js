import React, { useState } from 'react';
import './LoginModal.css'; // Optional custom styling
import axios from 'axios';

const LoginModal = ({ onClose, onSuccess }) => {
  const [formData, setFormData] = useState({ email: '', password: '' });

  const handleChange = (e) => {
    setFormData({...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${process.env.DATABASE_LINK}/login`, formData);
      localStorage.setItem('token', res.data.token);
      onSuccess(); // Call back to navigate to dashboard
    } catch (err) {
      alert('Invalid credentials');
    }
  };

  return (
    <div className="modal-overlay">
      <div className="login-modal">
        <button className="close-btn" onClick={onClose}>×</button>
        <h3>Login</h3>
        <form onSubmit={handleSubmit}>
          <input type="email" name="email" placeholder="Email" onChange={handleChange} required />
          <input type="password" name="password" placeholder="Password" onChange={handleChange} required />
          <button type="submit">Login</button>
        </form>
      </div>
    </div>
  );
};

export default LoginModal;
