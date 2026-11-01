import { formatDate } from '../../utils/format.js';
import Button from '../ui/Button.jsx';

const STATUS_STYLES = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  DELETED: 'bg-red-50 text-red-700',
};

/** One Lead Ads form: how many of its leads are here, how its last sync went, and its controls. */
export default function FormCard({ form, pageName, canManage, busy, onToggle, onSync }) {
  const deleted = form.status === 'DELETED';
  const lastSyncFailed = form.lastSyncStatus && form.lastSyncStatus !== 'ok';

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{form.name ?? `Form ${form.formId}`}</h3>
          <p className="text-xs text-slate-500">
            {pageName ?? `Page ${form.pageId}`} · Form ID {form.formId}
            {form.questions.length > 0 && ` · ${form.questions.length} questions`}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            STATUS_STYLES[form.status] ?? 'bg-slate-100 text-slate-600'
          }`}
        >
          {form.status ?? 'Unknown'}
        </span>
      </div>

      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-slate-500">Leads here</dt>
          <dd className="mt-0.5 font-medium">{form.storedLeads}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Leads on Facebook</dt>
          <dd className="mt-0.5 font-medium">{form.facebookLeadsCount ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Last synced</dt>
          <dd className="mt-0.5 font-medium">{formatDate(form.lastSyncedAt) ?? 'Never'}</dd>
        </div>
      </dl>

      {lastSyncFailed && form.lastSyncMessage && (
        <p className="mt-3 text-sm text-amber-800">{form.lastSyncMessage}</p>
      )}

      {canManage && !deleted && (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Button variant="secondary" loading={busy} onClick={onSync}>
            Sync now
          </Button>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.syncEnabled}
              onChange={(event) => onToggle(event.target.checked)}
              className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Include in automatic sync
          </label>
        </div>
      )}
    </li>
  );
}
