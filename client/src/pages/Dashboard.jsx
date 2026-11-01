import { useAuth } from '../hooks/useAuth.js';

const STATS = ['Total Leads', 'New Leads', 'Contacted Leads', 'Qualified Leads', 'Converted Leads'];

export default function Dashboard() {
  const { user, workspace } = useAuth();

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">
        Welcome back, {user.name.split(' ')[0]}. Here is {workspace.name} at a glance.
      </p>

      <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {STATS.map((label) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-5">
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className="mt-2 text-3xl font-semibold text-slate-300">&mdash;</dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-sm font-medium text-slate-700">Live statistics arrive in Phase 8</p>
        <p className="mt-1 text-sm text-slate-500">This section is scaffolded and not built yet.</p>
      </div>
    </div>
  );
}
