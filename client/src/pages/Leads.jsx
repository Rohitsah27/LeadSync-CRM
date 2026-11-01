import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import LeadStatusBadge from '../components/leads/LeadStatusBadge.jsx';
import Alert from '../components/ui/Alert.jsx';
import Button from '../components/ui/Button.jsx';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { useForms } from '../hooks/useForms.js';
import { fetchLeads } from '../services/leads.js';
import { formatDateTime } from '../utils/format.js';
import { LEAD_STATUSES } from '../utils/leads.js';

const PAGE_SIZE = 25;

const selectClass =
  'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';

export default function Leads() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [formId, setFormId] = useState('');
  const forms = useForms();

  const load = useCallback(
    () =>
      fetchLeads({
        page,
        limit: PAGE_SIZE,
        ...(status && { status }),
        ...(formId && { formId }),
      }),
    [page, status, formId],
  );
  const { status: loadStatus, data, error, reload } = useAsyncData(load);

  const filtered = Boolean(status || formId);
  const changeFilter = (setter) => (event) => {
    setter(event.target.value);
    setPage(1);
  };

  const first = data && data.total > 0 ? (data.page - 1) * data.limit + 1 : 0;
  const last = data ? Math.min(data.page * data.limit, data.total) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">All Leads</h1>
        <p className="mt-1 text-sm text-slate-500">Everyone who filled in one of your forms.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="status-filter" className="block text-sm font-medium text-slate-700">
            Status
          </label>
          <select
            id="status-filter"
            value={status}
            onChange={changeFilter(setStatus)}
            className={selectClass}
          >
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="form-filter" className="block text-sm font-medium text-slate-700">
            Form
          </label>
          <select
            id="form-filter"
            value={formId}
            onChange={changeFilter(setFormId)}
            className={selectClass}
          >
            <option value="">All forms</option>
            {forms.forms.map((form) => (
              <option key={form.formId} value={form.formId}>
                {form.name ?? `Form ${form.formId}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadStatus === 'loading' && !data && (
        <p role="status" className="text-sm text-slate-500">
          Loading leads&hellip;
        </p>
      )}

      {loadStatus === 'error' && (
        <div className="space-y-4">
          <Alert>{error}</Alert>
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      )}

      {data && data.total === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">
            {filtered ? 'No leads match these filters' : 'No leads yet'}
          </p>
          {!filtered && (
            <p className="mt-1 text-sm text-slate-500">
              Connect a Page, then sync its forms on the{' '}
              <Link to="/forms" className="font-medium text-indigo-600 hover:text-indigo-500">
                Lead Forms screen
              </Link>
              .
            </p>
          )}
        </div>
      )}

      {data && data.total > 0 && (
        <>
          <ul
            aria-label="Leads"
            className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white"
          >
            {data.leads.map((lead) => (
              <li key={lead.id}>
                <Link
                  to={`/leads/${lead.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {lead.fullName ?? 'No name'}
                    </p>
                    <p className="truncate text-sm text-slate-500">
                      {[lead.email, lead.phone].filter(Boolean).join(' · ') || 'No contact details'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                    <span className="hidden sm:inline">{lead.formName ?? lead.formId}</span>
                    <span>{formatDateTime(lead.createdTime)}</span>
                    <LeadStatusBadge status={lead.leadStatus} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-500">
              Showing {first}&ndash;{last} of {data.total}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-sm text-slate-600">
                Page {data.page} of {data.totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
