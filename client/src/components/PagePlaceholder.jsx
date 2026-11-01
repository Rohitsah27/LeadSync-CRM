export default function PagePlaceholder({ title, description, phase }) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{description}</p>

      <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-sm font-medium text-slate-700">Coming in Phase {phase}</p>
        <p className="mt-1 text-sm text-slate-500">This section is scaffolded and not built yet.</p>
      </div>
    </div>
  );
}
