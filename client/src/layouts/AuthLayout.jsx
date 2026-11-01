import { Outlet } from 'react-router';
import Brand from '../components/Brand.jsx';

export default function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Brand />
      <main className="mt-8 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <Outlet />
      </main>
    </div>
  );
}
