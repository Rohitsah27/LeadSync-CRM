import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline-indigo-600',
  secondary:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-indigo-600',
  danger: 'bg-red-600 text-white hover:bg-red-500 focus-visible:outline-red-600',
};

export default function Button({
  variant = 'primary',
  loading = false,
  disabled = false,
  className = '',
  children,
  ...props
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
