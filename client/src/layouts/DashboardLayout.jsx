import {
  ClipboardList,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Plug,
  Settings,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import ApiStatus from '../components/ApiStatus.jsx';
import Brand from '../components/Brand.jsx';
import { useAuth } from '../hooks/useAuth.js';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/connections', label: 'Facebook Connections', icon: Plug },
  { to: '/pages', label: 'Facebook Pages', icon: Layers },
  { to: '/forms', label: 'Lead Forms', icon: ClipboardList },
  { to: '/leads', label: 'All Leads', icon: Users },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/profile', label: 'Profile', icon: UserCircle },
];

function navLinkClass({ isActive }) {
  const base = 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors';
  return isActive
    ? `${base} bg-indigo-50 text-indigo-700`
    : `${base} text-slate-600 hover:bg-slate-100 hover:text-slate-900`;
}

export default function DashboardLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const { user, workspace, signOut } = useAuth();

  return (
    <div className="min-h-screen lg:flex">
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Brand />
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          >
            <X className="size-5" />
          </button>
        </div>

        <nav aria-label="Primary" className="flex-1 space-y-1 px-3 py-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={navLinkClass}
              onClick={() => setNavOpen(false)}
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            <Menu className="size-5" />
          </button>

          <div className="ml-auto flex items-center gap-3 sm:gap-4">
            <ApiStatus />
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium text-slate-700">{user.name}</p>
              <p className="text-xs text-slate-500">{workspace.name}</p>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
