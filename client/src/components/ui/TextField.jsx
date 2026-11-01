import { useId } from 'react';

export default function TextField({ label, error, hint, className = '', ...inputProps }) {
  const id = useId();
  const messageId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={messageId}
        className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500 ${
          error
            ? 'border-red-400 focus:ring-red-200'
            : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-200'
        }`}
        {...inputProps}
      />
      {error && (
        <p id={messageId} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={messageId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
}
