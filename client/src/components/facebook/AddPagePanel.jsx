import { useCallback, useState } from 'react';
import { useAsyncData } from '../../hooks/useAsyncData.js';
import { connectPage, fetchAvailablePages } from '../../services/facebook.js';
import { getErrorMessage } from '../../utils/errors.js';
import Alert from '../ui/Alert.jsx';
import Button from '../ui/Button.jsx';
import PageAvatar from './PageAvatar.jsx';

/** Lets an admin choose, from what Facebook says the account manages, which Pages to connect. */
export default function AddPagePanel({ connections, onConnected }) {
  const [selectedId, setSelectedId] = useState(connections[0].id);
  const [connectingId, setConnectingId] = useState(null);
  const [error, setError] = useState(null);

  // The chosen account may have been removed or reconnected since it was picked.
  const connection = connections.find((candidate) => candidate.id === selectedId) ?? connections[0];
  const load = useCallback(() => fetchAvailablePages(connection.id), [connection.id]);
  const { status, data: pages, error: loadError, reload } = useAsyncData(load);

  async function handleConnect(pageId) {
    setError(null);
    setConnectingId(pageId);
    try {
      await connectPage({ connectionId: connection.id, pageId });
      onConnected();
      reload();
    } catch (err) {
      setError(getErrorMessage(err));
      reload();
    } finally {
      setConnectingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {connections.length > 1 && (
        <div>
          <label htmlFor="facebook-account" className="block text-sm font-medium text-slate-700">
            Facebook account
          </label>
          <select
            id="facebook-account"
            value={connection.id}
            onChange={(event) => setSelectedId(event.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            {connections.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name ?? 'Facebook account'}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <Alert>{error}</Alert>}

      {status === 'loading' && (
        <p role="status" className="text-sm text-slate-500">
          Loading Pages from Facebook&hellip;
        </p>
      )}

      {status === 'error' && (
        <div className="space-y-4">
          <Alert>{loadError}</Alert>
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      )}

      {status === 'ready' && pages.length === 0 && (
        <p className="text-sm text-slate-500">
          This Facebook account does not manage any Pages, or did not share any with LeadSync.
        </p>
      )}

      {status === 'ready' && pages.length > 0 && (
        <ul aria-label="Available Pages" className="divide-y divide-slate-100">
          {pages.map((page) => (
            <li key={page.pageId} className="flex items-center gap-4 py-3">
              <PageAvatar key={page.pictureUrl} name={page.name} url={page.pictureUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {page.name ?? `Page ${page.pageId}`}
                </p>
                <p className="truncate text-xs text-slate-500">
                  Page ID {page.pageId}
                  {page.category && ` · ${page.category}`}
                </p>
                {page.canRetrieveLeads === false && (
                  <p className="mt-0.5 text-xs text-amber-700">
                    No Advertiser access on this Page, so leads may not be retrievable.
                  </p>
                )}
              </div>
              {page.connected && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                  Connected
                </span>
              )}
              {!page.connected && page.inUseElsewhere && (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                  Used by another workspace
                </span>
              )}
              {!page.connected && !page.inUseElsewhere && (
                <Button
                  variant="secondary"
                  loading={connectingId === page.pageId}
                  disabled={connectingId !== null}
                  aria-label={`Connect ${page.name ?? page.pageId}`}
                  onClick={() => handleConnect(page.pageId)}
                >
                  Connect
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
