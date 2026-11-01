import { useState } from 'react';
import { Link } from 'react-router';
import { disconnectPage, recheckPage, subscribePage } from '../../services/facebook.js';
import { getErrorMessage } from '../../utils/errors.js';
import { formatDate, formatDateTime } from '../../utils/format.js';
import Alert from '../ui/Alert.jsx';
import Button from '../ui/Button.jsx';
import PageAvatar from './PageAvatar.jsx';
import RemovalConfirm from './RemovalConfirm.jsx';

export default function ConnectedPageCard({ page, canManage, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState(null);

  const name = page.name ?? `Page ${page.pageId}`;
  const isActive = page.status === 'active';
  const lacksAdvertiserAccess = page.tasks.length > 0 && !page.tasks.includes('ADVERTISE');

  async function run(action, task) {
    setError(null);
    setBusy(action);
    try {
      await task();
      setConfirmingRemoval(false);
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-4">
        <PageAvatar key={page.pictureUrl} name={name} url={page.pictureUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="truncate text-base font-semibold">{name}</h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
              }`}
            >
              {isActive ? 'Connected' : 'Needs reconnecting'}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Page ID {page.pageId}
            {page.category && ` · ${page.category}`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Connected {formatDate(page.connectedAt)}
            {page.lastVerifiedAt && ` · Checked ${formatDate(page.lastVerifiedAt)}`}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {!isActive && (
          <Alert variant="warning">
            {page.statusReason ?? 'This Page can no longer be used.'} Reconnect its Facebook account
            on the{' '}
            <Link to="/connections" className="font-medium underline">
              Connections page
            </Link>{' '}
            to restore it.
          </Alert>
        )}
        {isActive && lacksAdvertiserAccess && (
          <Alert variant="warning">
            Your Facebook account does not have Advertiser access on this Page, so its leads may not
            be retrievable.
          </Alert>
        )}
        {error && <Alert>{error}</Alert>}
      </div>

      {isActive && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
          <div className="min-w-0 text-sm">
            <p className="flex items-center gap-2 font-medium text-slate-700">
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${
                  page.webhook.subscribed ? 'bg-emerald-500' : 'bg-amber-400'
                }`}
              />
              {page.webhook.subscribed
                ? 'Receiving new leads automatically'
                : 'Not receiving new leads automatically'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {page.webhook.error ??
                (page.webhook.lastEventAt
                  ? `Last new lead ${formatDateTime(page.webhook.lastEventAt)}`
                  : page.webhook.subscribed
                    ? 'No new leads have arrived yet.'
                    : 'You can still pull leads with Sync leads.')}
            </p>
          </div>
          {canManage && !page.webhook.subscribed && (
            <Button
              variant="secondary"
              loading={busy === 'subscribe'}
              onClick={() => run('subscribe', () => subscribePage(page.pageId))}
            >
              Subscribe
            </Button>
          )}
        </div>
      )}

      {canManage && !confirmingRemoval && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            loading={busy === 'check'}
            onClick={() => run('check', () => recheckPage(page.pageId))}
          >
            Re-check
          </Button>
          <Button variant="secondary" onClick={() => setConfirmingRemoval(true)}>
            Disconnect
          </Button>
        </div>
      )}

      {canManage && confirmingRemoval && (
        <RemovalConfirm
          message={`Disconnect ${name}? Its access token is deleted and no more leads are synced from it. Leads already in LeadSync are kept.`}
          busy={busy === 'remove'}
          onConfirm={() => run('remove', () => disconnectPage(page.pageId))}
          onCancel={() => setConfirmingRemoval(false)}
        />
      )}
    </li>
  );
}
