import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../hooks/useAuth.js';
import FullPageSpinner from './FullPageSpinner.jsx';

/** Login and registration pages: signed-in users are sent on to where they were headed. */
export default function GuestRoute() {
  const { status } = useAuth();
  const { state } = useLocation();

  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') {
    const from = state?.from;
    return <Navigate to={from ? `${from.pathname}${from.search}${from.hash}` : '/'} replace />;
  }

  return <Outlet />;
}
