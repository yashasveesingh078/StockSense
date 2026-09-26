import { useEffect, useState } from 'react';
import { AuthCtx } from './auth';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, getToken, setToken } from './api';
import { ToastProvider } from './components/ui';
import Layout from './components/Layout';
import { Login, Signup, ForgotPassword } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Operations from './pages/Operations';
import OperationForm from './pages/OperationForm';
import MoveHistory from './pages/MoveHistory';
import { Warehouses, Locations, Categories } from './pages/Settings';
import Profile from './pages/Profile';

export default function App() {
  const [user, setUser] = useState(null);
  // If there is no saved login token, we are ready straight away (no need to ask the server)
  const [ready, setReady] = useState(() => !getToken());

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const login = (token, u) => { setToken(token); setUser(u); };
  const logout = () => { setToken(null); setUser(null); };

  if (!ready) return <div className="splash">Loading…</div>;

  return (
    <AuthCtx.Provider value={{ user, setUser, login, logout }}>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
          <Route path="/signup" element={user ? <Navigate to="/" /> : <Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route element={user ? <Layout /> : <Navigate to="/login" />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/products" element={<Products />} />
            <Route path="/operations/:type" element={<Operations />} />
            <Route path="/operations" element={<Operations />} />
            <Route path="/operation/new/:type" element={<OperationForm />} />
            <Route path="/operation/:id" element={<OperationForm />} />
            <Route path="/moves" element={<MoveHistory />} />
            <Route path="/settings" element={<Navigate to="/settings/warehouses" />} />
            <Route path="/settings/warehouses" element={<Warehouses />} />
            <Route path="/settings/locations" element={<Locations />} />
            <Route path="/settings/categories" element={<Categories />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </ToastProvider>
    </AuthCtx.Provider>
  );
}