import { useState } from 'react';
import { Link } from 'react-router';
import FormCard from '../components/leads/FormCard.jsx';
import SyncNotice from '../components/leads/SyncNotice.jsx';
import Alert from '../components/ui/Alert.jsx';
import Button from '../components/ui/Button.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useForms } from '../hooks/useForms.js';
import { usePages } from '../hooks/usePages.js';
import { refreshForms, syncLeads, updateForm } from '../services/leads.js';
import { getErrorMessage } from '../utils/errors.js';
import { summarizeFormRefresh, summarizeLeadSync } from '../utils/leads.js';
import { canManageWorkspace } from '../utils/permissions.js';

export default function LeadForms() {
  const { user } = useAuth();
  const canManage = canManageWorkspace(user.role);
  const forms = useForms();
  const pages = usePages();
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const pageNames = new Map(pages.pages.map((page) => [page.pageId, page.name]));

  /** Runs a sync action, shows what happened, and reloads the forms so the numbers are current. */
  async function run(key, task, summarize) {
    setError(null);
    setNotice(null);
    setBusy(key);
    try {
      setNotice(summarize(await task()));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
      forms.reload();
    }
  }

  async function handleToggle(form, syncEnabled) {
    setError(null);
    try {
      await updateForm(form.formId, { syncEnabled });
    } catch (err) {
      setError(getErrorMessage(err));
    }
    forms.reload();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lead Forms</h1>
          <p className="mt-1 text-sm text-slate-500">
            Lead Ads forms on your connected Pages, and the leads pulled from them.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={busy === 'forms'}
              disabled={busy !== null}
              onClick={() => run('forms', () => refreshForms(), summarizeFormRefresh)}
            >
              Refresh forms
            </Button>
            <Button
              loading={busy === 'leads'}
              disabled={busy !== null}
              onClick={() => run('leads', () => syncLeads(), summarizeLeadSync)}
            >
              Sync leads
            </Button>
          </div>
        )}
      </div>

      {notice && <SyncNotice notice={notice} />}
      {error && <Alert>{error}</Alert>}

      {forms.status === 'loading' && (
        <p role="status" className="text-sm text-slate-500">
          Loading forms&hellip;
        </p>
      )}

      {forms.status === 'error' && (
        <div className="space-y-4">
          <Alert>{forms.error}</Alert>
          <Button variant="secondary" onClick={forms.reload}>
            Try again
          </Button>
        </div>
      )}

      {forms.status === 'ready' && forms.forms.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">No lead forms yet</p>
          <p className="mt-1 text-sm text-slate-500">
            {pages.pages.length === 0 ? (
              <>
                Connect a Facebook Page on the{' '}
                <Link to="/pages" className="font-medium text-indigo-600 hover:text-indigo-500">
                  Pages screen
                </Link>
                , then refresh the forms.
              </>
            ) : canManage ? (
              'Choose Refresh forms to load them from Facebook.'
            ) : (
              'An owner or admin can load them from Facebook.'
            )}
          </p>
        </div>
      )}

      {forms.status === 'ready' && forms.forms.length > 0 && (
        <ul aria-label="Lead forms" className="space-y-4">
          {forms.forms.map((form) => (
            <FormCard
              key={form.id}
              form={form}
              pageName={pageNames.get(form.pageId)}
              canManage={canManage}
              busy={busy === form.formId}
              onToggle={(syncEnabled) => handleToggle(form, syncEnabled)}
              onSync={() =>
                run(form.formId, () => syncLeads({ formId: form.formId }), summarizeLeadSync)
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
