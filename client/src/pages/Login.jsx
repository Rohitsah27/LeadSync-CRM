import { Link } from 'react-router';

export default function Login() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-slate-500">Authentication arrives in Phase 2.</p>
      <p className="mt-6 text-sm text-slate-600">
        New to LeadSync?{' '}
        <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
          Create an account
        </Link>
      </p>
    </>
  );
}
