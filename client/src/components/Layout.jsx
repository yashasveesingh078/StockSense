// Top navigation bar (as in the wireframe): Dashboard · Operations ▾ · Products · Move History · Settings ▾ · (A) ▾
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

function Dropdown({ label, active, items, align = 'left', button }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="dropdown" ref={ref}>
      {button ? button(() => setOpen(!open)) : (
        <button className={`top-link ${active ? 'active' : ''}`} onClick={() => setOpen(!open)}>
          {label} <span className="caret">▾</span>
        </button>
      )}
      {open && (
        <div className={`dropdown-menu ${align === 'right' ? 'right' : ''}`}>
          {items.map((it) =>
            it.onClick ? (
              <button key={it.label} className="dropdown-item" onClick={it.onClick}>{it.label}</button>
            ) : (
              <NavLink key={it.to} to={it.to} className="dropdown-item">{it.label}</NavLink>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);

  const inOps = pathname.startsWith('/operation');
  const inSettings = pathname.startsWith('/settings');
  const link = (to, label) => (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => 'top-link' + (isActive ? ' active' : '')}>{label}</NavLink>
  );

  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <div className="logo">S</div>
            <span className="brand-name">StockSense</span>
          </NavLink>
          <button className="icon-btn burger" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Menu">☰</button>
          <nav className={`topnav ${mobileOpen ? 'open' : ''}`}>
            {link('/', 'Dashboard')}
            <Dropdown label="Operations" active={inOps} items={[
              { to: '/operations/receipt', label: 'Receipts' },
              { to: '/operations/delivery', label: 'Deliveries' },
              { to: '/operations/internal', label: 'Internal Transfers' },
              { to: '/operations/adjustment', label: 'Adjustments' },
            ]} />
            {link('/products', 'Products')}
            {link('/moves', 'Move History')}
            <Dropdown label="Settings" active={inSettings} items={[
              { to: '/settings/warehouses', label: 'Warehouse' },
              { to: '/settings/locations', label: 'Locations' },
              { to: '/settings/categories', label: 'Product Categories' },
            ]} />
          </nav>
          <Dropdown align="right"
            button={(toggle) => (
              <button className="avatar" onClick={toggle} title={user.name}>{(user.name || user.login_id)[0].toUpperCase()}</button>
            )}
            items={[
              { to: '/profile', label: 'My Profile' },
              { label: 'Logout', onClick: () => { logout(); navigate('/login'); } },
            ]} />
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}