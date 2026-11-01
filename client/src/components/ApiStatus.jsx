import { useApiHealth } from '../hooks/useApiHealth.js';

const STATES = {
  checking: { label: 'Checking API', dot: 'bg-amber-400' },
  online: { label: 'API online', dot: 'bg-emerald-500' },
  offline: { label: 'API offline', dot: 'bg-red-500' },
};

export default function ApiStatus() {
  const { label, dot } = STATES[useApiHealth()];

  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600"
    >
      <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
