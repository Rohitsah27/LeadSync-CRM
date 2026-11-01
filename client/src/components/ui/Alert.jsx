const VARIANTS = {
  error: { role: 'alert', style: 'border-red-200 bg-red-50 text-red-800' },
  success: { role: 'status', style: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
};

export default function Alert({ variant = 'error', children }) {
  const { role, style } = VARIANTS[variant];

  return (
    <div role={role} className={`rounded-lg border px-3 py-2 text-sm ${style}`}>
      {children}
    </div>
  );
}
