const STYLES = {
  new: 'bg-sky-50 text-sky-700',
  contacted: 'bg-amber-50 text-amber-800',
  qualified: 'bg-violet-50 text-violet-700',
  converted: 'bg-emerald-50 text-emerald-700',
  lost: 'bg-slate-100 text-slate-600',
};

export default function LeadStatusBadge({ status }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STYLES[status] ?? STYLES.lost}`}
    >
      {status}
    </span>
  );
}
