import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Layout } from './components/Layout';
import AuditLog from './pages/AuditLog';
import Creators from './pages/Creators';
import Moderation from './pages/Moderation';

function App() {
  return (
    <BrowserRouter basename="/admin">
      <Layout>
        <Routes>
          <Route path="/" element={
            <div style={{ padding: '20px' }}>
              <h1>Admin Dashboard</h1>
              <nav style={{ marginTop: '20px', display: 'flex', gap: '20px' }}>
                <Link to="/creators">Creators</Link>
                <Link to="/moderation">Moderation</Link>
                <Link to="/audit-log">Audit Log</Link>
              </nav>
            </div>
          } />
          <Route path="/creators" element={<Creators />} />
          <Route path="/moderation" element={<Moderation />} />
          <Route path="/audit-log" element={<AuditLog />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
