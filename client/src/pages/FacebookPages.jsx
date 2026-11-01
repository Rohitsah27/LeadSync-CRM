import { Link } from 'react-router';
import AddPagePanel from '../components/facebook/AddPagePanel.jsx';
import ConnectedPageCard from '../components/facebook/ConnectedPageCard.jsx';
import Alert from '../components/ui/Alert.jsx';
import Button from '../components/ui/Button.jsx';
import Section from '../components/ui/Section.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useConnections } from '../hooks/useConnections.js';
import { usePages } from '../hooks/usePages.js';
import { canManageWorkspace } from '../utils/permissions.js';

function ConnectionsLink({ children }) {
  return (
    <Link to="/connections" className="font-medium text-indigo-600 hover:text-indigo-500">
      {children}
    </Link>
  );
}

/** What to show in place of the "add a Page" list when there is nothing to add from. */
function AddPageUnavailable({ configured, connections }) {
  if (!configured) {
    return (
      <Alert variant="warning">
        Facebook integration is not configured on this server yet, so Pages cannot be added.
      </Alert>
    );
  }
  if (connections.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        Connect a Facebook account first on the <ConnectionsLink>Connections page</ConnectionsLink>.
      </p>
    );
  }
  return (
    <Alert variant="warning">
      Your Facebook connection needs attention. Reconnect it on the{' '}
      <ConnectionsLink>Connections page</ConnectionsLink> to add Pages.
    </Alert>
  );
}

export default function FacebookPages() {
  const { user } = useAuth();
  const canManage = canManageWorkspace(user.role);
  const pages = usePages();
  const connections = useConnections();
  const activeConnections = connections.connections.filter(
    (connection) => connection.status === 'active',
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Facebook Pages</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose which Facebook Pages feed leads into your workspace.
        </p>
      </div>

      <Section title="Connected Pages" description="Pages this workspace receives leads from.">
        {pages.status === 'loading' && (
          <p role="status" className="text-sm text-slate-500">
            Loading Pages&hellip;
          </p>
        )}

        {pages.status === 'error' && (
          <div className="space-y-4">
            <Alert>{pages.error}</Alert>
            <Button variant="secondary" onClick={pages.reload}>
              Try again
            </Button>
          </div>
        )}

        {pages.status === 'ready' && pages.pages.length === 0 && (
          <p className="text-sm text-slate-500">
            No Pages connected yet.
            {canManage ? ' Add one below.' : ' An owner or admin can add one.'}
          </p>
        )}

        {pages.status === 'ready' && pages.pages.length > 0 && (
          <ul aria-label="Connected Pages" className="space-y-4">
            {pages.pages.map((page) => (
              <ConnectedPageCard
                key={page.id}
                page={page}
                canManage={canManage}
                onChanged={pages.reload}
              />
            ))}
          </ul>
        )}
      </Section>

      {canManage && connections.status === 'ready' && (
        <Section
          title="Add a Page"
          description="These are the Pages your Facebook account manages. Facebook decides which ones appear."
        >
          {connections.configured && activeConnections.length > 0 ? (
            <AddPagePanel connections={activeConnections} onConnected={pages.reload} />
          ) : (
            <AddPageUnavailable
              configured={connections.configured}
              connections={connections.connections}
            />
          )}
        </Section>
      )}
    </div>
  );
}
