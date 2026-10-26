import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './auth/AuthGate.jsx';
import './index.css'; // <--- MUST BE IMPORTED HERE

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate>{(auth) => <App auth={auth} />}</AuthGate>
  </React.StrictMode>
);
