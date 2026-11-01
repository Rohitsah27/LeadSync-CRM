import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { disconnectConnection, recheckConnection } from '../../services/facebook.js';
import { getErrorMessage } from '../../utils/errors.js';
import { daysUntil, formatDate } from '../../utils/format.js';
import Alert from '../ui/Alert.jsx';
import Button from '../ui/Button.jsx';
import RemovalConfirm from './RemovalConfirm.jsx';

const STATUS = {
  active: { label: 'Connected', style: 'bg-emerald-50 text-emerald-700' },
  expired: { label: 'Expired', style: 'bg-amber-50 text-amber-800' },
  revoked: { label: 'Access removed', style: 'bg-red-50 text-red-700' },
  error: { label: 'Needs attention', style: 'bg-red-50 text-red-700' },
};
const EXPIRY_WARNING_DAYS = 14;

export default function ConnectionCard({
  connection,
  requiredScopes,
  canManage,
  onChanged,
  onReconnect,
}) {
  const [busy, setBusy] = useState(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState(null);

  const name = connection.name ?? 'Facebook account';
  const isActive = connection.status === 'active';
  const status = STATUS[connection.status] ?? STATUS.error;
  const daysLeft = daysUntil(connection.dataAccessExpiresAt);
  const expiresSoon = isActive && daysLeft !== null && daysLeft <= EXPIRY_WARNING_DAYS;

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{name}</h3>
          <p className="text-xs text-slate-500">Facebook ID {connection.facebookUserId}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.style}`}>
          {status.label}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {!isActive && (
          <Alert variant="warning">
            {connection.statusReason ?? 'This connection can no longer be used.'} Reconnect to
            continue syncing leads.
          </Alert>
        )}
        {isActive && connection.missingScopes.length > 0 && (
          <Alert variant="warning">
            Missing permissions: {connection.missingScopes.join(', ')}. Reconnect and approve every
            requested permission, or leads cannot be retrieved.
          </Alert>
        )}
        {expiresSoon && (
          <Alert variant="warning">
            Facebook data access ends {daysLeft <= 0 ? 'today' : `in ${daysLeft} days`}. Reconnect
            to renew it.
          </Alert>
        )}
        {error && <Alert>{error}</Alert>}
      </div>

      <ul aria-label="Permissions" className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {requiredScopes.map((scope) => {
          const granted = connection.grantedScopes.includes(scope);
          const Icon = granted ? Check : X;
          return (
            <li key={scope} className="flex items-center gap-2 text-sm text-slate-600">
              <Icon
                className={`size-4 shrink-0 ${granted ? 'text-emerald-600' : 'text-red-500'}`}
                aria-hidden="true"
              />
              <span className="truncate">{scope}</span>
              <span className="sr-only">{granted ? 'Granted' : 'Missing'}</span>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs text-slate-500">
        Connected {formatDate(connection.connectedAt)}
        {connection.lastVerifiedAt && ` · Checked ${formatDate(connection.lastVerifiedAt)}`}
        {connection.dataAccessExpiresAt &&
          ` · Data access until ${formatDate(connection.dataAccessExpiresAt)}`}
      </p>

      {canManage && !confirmingRemoval && (
        <div className="mt-4 flex flex-wrap gap-2">
          {!isActive && <Button onClick={onReconnect}>Reconnect</Button>}
          {isActive && (
            <Button
              variant="secondary"
              loading={busy === 'check'}
              onClick={() => run('check', () => recheckConnection(connection.id))}
            >
              Re-check
            </Button>
          )}
          <Button variant="secondary" onClick={() => setConfirmingRemoval(true)}>
            Disconnect
          </Button>
        </div>
      )}

      {canManage && confirmingRemoval && (
        <RemovalConfirm
          message={`Disconnect ${name}? Its Pages are disconnected too, lead syncing from this account stops and its Facebook permissions are revoked. Leads already in LeadSync are kept.`}
          busy={busy === 'remove'}
          onConfirm={() => run('remove', () => disconnectConnection(connection.id))}
          onCancel={() => setConfirmingRemoval(false)}
        />
      )}
    </li>
  );
}
