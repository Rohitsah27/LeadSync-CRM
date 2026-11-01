import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../hooks/useAuth.js';
import FullPageSpinner from './FullPageSpinner.jsx';

export default function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSpinner />;
  if (status !== 'authenticated')
    return <Navigate to="/login" replace state={{ from: location }} />;

  return <Outlet />;
}
