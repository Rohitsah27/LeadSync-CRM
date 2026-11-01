import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import ConnectionCard from '../components/facebook/ConnectionCard.jsx';
import Alert from '../components/ui/Alert.jsx';
import Button from '../components/ui/Button.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useConnections } from '../hooks/useConnections.js';
import { startConnect } from '../services/facebook.js';
import { getErrorMessage } from '../utils/errors.js';
import { redirectTo } from '../utils/navigation.js';
import { canManageWorkspace } from '../utils/permissions.js';

const FAILURE_MESSAGES = {
  denied: 'Facebook access was not granted. Connect again and approve the requested permissions.',
  state: 'That connection attempt expired or was opened in a different browser. Please try again.',
  exchange: 'Facebook did not accept the login. Please try again.',
  unavailable: 'Facebook could not be reached. Please try again in a moment.',
  config: 'Facebook integration is not configured on the server yet.',
};

/** Reads the outcome the API appended to the URL when it sent the browser back from Facebook. */
function noticeFromUrl(params) {
  const outcome = params.get('facebook');
  if (outcome === 'connected') {
    return { variant: 'success', message: 'Facebook account connected.' };
  }
  if (outcome === 'error') {
    const message =
      FAILURE_MESSAGES[params.get('reason')] ??
      'Something went wrong while connecting Facebook. Please try again.';
    return { variant: 'error', message };
  }
  return null;
}

export default function FacebookConnections() {
  const { user } = useAuth();
  const canManage = canManageWorkspace(user.role);
  const { status, configured, requiredScopes, connections, error, reload } = useConnections();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice] = useState(() => noticeFromUrl(searchParams));
  const [connectError, setConnectError] = useState(null);
  const [connecting, setConnecting] = useState(false);

  // The outcome is shown once; drop it from the URL so a refresh does not repeat it.
  useEffect(() => {
    if (searchParams.has('facebook')) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  async function handleConnect() {
    setConnectError(null);
    setConnecting(true);
    try {
      redirectTo(await startConnect());
    } catch (err) {
      setConnectError(getErrorMessage(err));
      setConnecting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Facebook Connections</h1>
          <p className="mt-1 text-sm text-slate-500">
            Connect the Facebook accounts that manage the Pages you run lead ads on.
          </p>
        </div>
        {canManage && configured && (
          <Button onClick={handleConnect} loading={connecting}>
            Connect Facebook
          </Button>
        )}
      </div>

      {notice && <Alert variant={notice.variant}>{notice.message}</Alert>}
      {connectError && <Alert>{connectError}</Alert>}
      {status === 'ready' && !configured && (
        <Alert variant="warning">
          Facebook integration is not configured on this server yet. Add the Meta app settings to
          the server environment to enable it.
        </Alert>
      )}
      {status === 'ready' && configured && !canManage && (
        <p className="text-sm text-slate-500">
          Only workspace owners and admins can connect or disconnect Facebook accounts.
        </p>
      )}

      {status === 'loading' && (
        <p role="status" className="text-sm text-slate-500">
          Loading connections&hellip;
        </p>
      )}

      {status === 'error' && (
        <div className="space-y-4">
          <Alert>{error}</Alert>
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      )}

      {status === 'ready' && connections.length === 0 && configured && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">No Facebook account connected yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Connect an account to choose Pages and start receiving leads.
          </p>
        </div>
      )}

      {status === 'ready' && connections.length > 0 && (
        <ul aria-label="Facebook connections" className="space-y-4">
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              requiredScopes={requiredScopes}
              canManage={canManage}
              onChanged={reload}
              onReconnect={handleConnect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
