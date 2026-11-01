import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import AuthProvider from './context/AuthProvider.jsx';
import * as authService from './services/auth.js';
import { fetchHealth } from './services/health.js';
import * as facebookService from './services/facebook.js';
import * as leadsService from './services/leads.js';
import * as workspaceService from './services/workspace.js';
import { redirectTo } from './utils/navigation.js';

vi.mock('./services/auth.js');
vi.mock('./services/health.js');
vi.mock('./services/workspace.js');
vi.mock('./services/facebook.js');
vi.mock('./services/leads.js');
vi.mock('./utils/navigation.js');

const session = {
  user: {
    id: 'u1',
    name: 'Asha Rao',
    email: 'asha@example.com',
    role: 'owner',
    workspaceId: 'w1',
  },
  workspace: { id: 'w1', name: 'Rao Realty' },
};

function apiError(status, error) {
  return Object.assign(new Error('Request failed'), { response: { status, data: { error } } });
}

// Block bodies on purpose: vitest treats a function returned from beforeEach as a teardown hook.
const signedIn = () => {
  authService.restoreSession.mockResolvedValue(session);
};
const signedOut = () => {
  authService.restoreSession.mockRejectedValue(
    apiError(401, { code: 'INVALID_REFRESH_TOKEN', message: 'Session expired' }),
  );
};

function renderAt(path) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  fetchHealth.mockResolvedValue({ status: 'ok' });
});

describe('signed-in navigation', () => {
  beforeEach(signedIn);

  it('shows the dashboard, the user and every navigation section', async () => {
    renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText(/Welcome back, Asha/)).toBeInTheDocument();
    expect(screen.getByText('Rao Realty', { selector: 'p' })).toBeInTheDocument();
    for (const name of [
      'Dashboard',
      'Facebook Connections',
      'Facebook Pages',
      'Lead Forms',
      'All Leads',
      'Settings',
      'Profile',
    ]) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    expect(await screen.findByText('API online')).toBeInTheDocument();
  });

  it('shows an offline indicator when the API is unreachable', async () => {
    fetchHealth.mockRejectedValue(new Error('Network Error'));
    renderAt('/');

    expect(await screen.findByText('API offline')).toBeInTheDocument();
  });

  it('renders the lead details route', async () => {
    leadsService.fetchLead.mockResolvedValue({
      id: 'abc123',
      fullName: 'Priya Shah',
      leadStatus: 'new',
      customFields: [],
      createdTime: '2026-10-31T11:59:00.000Z',
    });
    renderAt('/leads/abc123');

    expect(await screen.findByRole('heading', { name: 'Priya Shah' })).toBeInTheDocument();
    expect(leadsService.fetchLead).toHaveBeenCalledWith('abc123');
  });

  it('renders a not-found page for unknown routes', async () => {
    renderAt('/does-not-exist');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('sends signed-in users away from the login page', async () => {
    renderAt('/login');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('signs out and returns to the login page', async () => {
    authService.logout.mockResolvedValue();
    const user = userEvent.setup();
    renderAt('/');

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(authService.logout).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('signed-out access', () => {
  beforeEach(signedOut);

  it('redirects protected pages to the login page', async () => {
    renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });

  it('returns to the originally requested page after signing in', async () => {
    authService.login.mockResolvedValue(session);
    const user = userEvent.setup();
    renderAt('/profile');

    await user.type(await screen.findByLabelText('Email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(authService.login).toHaveBeenCalledWith({
      email: 'asha@example.com',
      password: 'correct-horse-battery',
    });
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
  });

  it('shows the server message when sign-in fails', async () => {
    authService.login.mockRejectedValue(
      apiError(401, { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }),
    );
    const user = userEvent.setup();
    renderAt('/login');

    await user.type(await screen.findByLabelText('Email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('explains connectivity problems', async () => {
    authService.login.mockRejectedValue(Object.assign(new Error('Network Error'), { request: {} }));
    const user = userEvent.setup();
    renderAt('/login');

    await user.type(await screen.findByLabelText('Email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), 'whatever-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach the server');
  });

  it('registers a new account and opens the dashboard', async () => {
    authService.register.mockResolvedValue(session);
    const user = userEvent.setup();
    renderAt('/register');

    await user.type(await screen.findByLabelText('Your name'), 'Asha Rao');
    await user.type(screen.getByLabelText('Business name'), 'Rao Realty');
    await user.type(screen.getByLabelText('Email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(authService.register).toHaveBeenCalledWith({
      name: 'Asha Rao',
      businessName: 'Rao Realty',
      email: 'asha@example.com',
      password: 'correct-horse-battery',
    });
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('shows validation errors next to the offending fields', async () => {
    authService.register.mockRejectedValue(
      apiError(400, {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [{ path: 'password', message: 'Use at least 10 characters' }],
      }),
    );
    const user = userEvent.setup();
    renderAt('/register');

    await user.type(await screen.findByLabelText('Your name'), 'Asha Rao');
    await user.type(screen.getByLabelText('Business name'), 'Rao Realty');
    await user.type(screen.getByLabelText('Email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('profile page', () => {
  beforeEach(signedIn);

  it('shows account details', async () => {
    renderAt('/profile');

    expect(await screen.findByLabelText('Name')).toHaveValue('Asha Rao');
    expect(screen.getByLabelText('Email')).toHaveValue('asha@example.com');
    expect(screen.getByLabelText('Workspace')).toHaveValue('Rao Realty');
    expect(screen.getByLabelText('Role')).toHaveValue('owner');
  });

  it('saves a new name', async () => {
    authService.updateProfile.mockResolvedValue({ ...session.user, name: 'Asha R.' });
    const user = userEvent.setup();
    renderAt('/profile');

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Asha R.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(authService.updateProfile).toHaveBeenCalledWith({ name: 'Asha R.' });
    expect(await screen.findByText('Profile updated.')).toBeInTheDocument();
  });

  it('changes the password and clears the form', async () => {
    authService.changePassword.mockResolvedValue(session);
    const user = userEvent.setup();
    renderAt('/profile');

    await user.type(await screen.findByLabelText('Current password'), 'correct-horse-battery');
    await user.type(screen.getByLabelText('New password'), 'a-brand-new-passphrase');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(authService.changePassword).toHaveBeenCalledWith({
      currentPassword: 'correct-horse-battery',
      newPassword: 'a-brand-new-passphrase',
    });
    expect(await screen.findByText(/Password updated/)).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('flags an incorrect current password on its field', async () => {
    authService.changePassword.mockRejectedValue(
      apiError(400, { code: 'INVALID_CURRENT_PASSWORD', message: 'Current password is incorrect' }),
    );
    const user = userEvent.setup();
    renderAt('/profile');

    await user.type(await screen.findByLabelText('Current password'), 'not-my-password');
    await user.type(screen.getByLabelText('New password'), 'a-brand-new-passphrase');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('signs out of all devices', async () => {
    authService.logoutAllDevices.mockResolvedValue();
    const user = userEvent.setup();
    renderAt('/profile');

    await user.click(await screen.findByRole('button', { name: 'Sign out of all devices' }));

    expect(authService.logoutAllDevices).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('settings page', () => {
  const members = [
    {
      id: 'u1',
      name: 'Asha Rao',
      email: 'asha@example.com',
      role: 'owner',
      isActive: true,
      lastLoginAt: '2026-11-01T10:00:00.000Z',
    },
    {
      id: 'u2',
      name: 'Ben Carter',
      email: 'ben@example.com',
      role: 'member',
      isActive: true,
      lastLoginAt: null,
    },
    {
      id: 'u3',
      name: 'Dana Lee',
      email: 'dana@example.com',
      role: 'admin',
      isActive: false,
      lastLoginAt: null,
    },
  ];

  const signInAs = (role) =>
    authService.restoreSession.mockResolvedValue({
      ...session,
      user: { ...session.user, role },
    });

  beforeEach(() => {
    workspaceService.fetchMembers.mockResolvedValue(members);
  });

  it('lets an owner rename the workspace', async () => {
    signInAs('owner');
    workspaceService.updateWorkspace.mockResolvedValue({ id: 'w1', name: 'Rao Properties' });
    const user = userEvent.setup();
    renderAt('/settings');

    const name = await screen.findByLabelText('Workspace name');
    expect(name).toHaveValue('Rao Realty');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await user.clear(name);
    await user.type(name, 'Rao Properties');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(workspaceService.updateWorkspace).toHaveBeenCalledWith({ name: 'Rao Properties' });
    expect(await screen.findByText('Workspace updated.')).toBeInTheDocument();
    expect(screen.getByText('Rao Properties', { selector: 'p' })).toBeInTheDocument();
  });

  it('lets an admin rename the workspace too', async () => {
    signInAs('admin');
    renderAt('/settings');

    expect(await screen.findByLabelText('Workspace name')).toBeEnabled();
  });

  it('shows the workspace name read-only to plain members', async () => {
    signInAs('member');
    renderAt('/settings');

    expect(await screen.findByLabelText('Workspace name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only owners and admins can change/)).toBeInTheDocument();
  });

  it('shows server validation errors under the name field', async () => {
    signInAs('owner');
    workspaceService.updateWorkspace.mockRejectedValue(
      apiError(400, {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [{ path: 'name', message: 'Business name must be at least 2 characters' }],
      }),
    );
    const user = userEvent.setup();
    renderAt('/settings');

    const name = await screen.findByLabelText('Workspace name');
    await user.clear(name);
    await user.type(name, 'A');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('Business name must be at least 2 characters'),
    ).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
  });

  it('lists the team with roles, a marker for the current user and deactivated accounts', async () => {
    signInAs('owner');
    renderAt('/settings');

    const list = await screen.findByRole('list', { name: 'Team members' });
    const rows = within(list).getAllByRole('listitem');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Asha Rao');
    expect(rows[0]).toHaveTextContent('(you)');
    expect(rows[0]).toHaveTextContent('owner');
    expect(rows[1]).toHaveTextContent('ben@example.com');
    expect(rows[1]).not.toHaveTextContent('(you)');
    expect(rows[2]).toHaveTextContent('Deactivated');
  });

  it('reports a failure to load the team and lets the user retry', async () => {
    signInAs('owner');
    workspaceService.fetchMembers
      .mockRejectedValueOnce(
        apiError(500, { code: 'INTERNAL_ERROR', message: 'Something went wrong' }),
      )
      .mockResolvedValueOnce(members);
    const user = userEvent.setup();
    renderAt('/settings');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('list', { name: 'Team members' })).toBeInTheDocument();
    expect(workspaceService.fetchMembers).toHaveBeenCalledTimes(2);
  });
});

describe('facebook connections page', () => {
  const required = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_metadata',
    'pages_manage_ads',
    'leads_retrieval',
  ];
  const connection = (overrides = {}) => ({
    id: 'c1',
    facebookUserId: '10001000100010',
    name: 'Fiona Business',
    status: 'active',
    statusReason: null,
    grantedScopes: required,
    missingScopes: [],
    tokenExpiresAt: null,
    dataAccessExpiresAt: null,
    lastVerifiedAt: '2026-11-01T10:00:00.000Z',
    connectedAt: '2026-10-30T10:00:00.000Z',
    connectedBy: 'u1',
    ...overrides,
  });
  const listing = (overrides = {}) => ({
    configured: true,
    requiredScopes: required,
    connections: [connection()],
    ...overrides,
  });
  const signInAs = (role) =>
    authService.restoreSession.mockResolvedValue({
      ...session,
      user: { ...session.user, role },
    });

  beforeEach(() => {
    signInAs('owner');
    facebookService.fetchConnections.mockResolvedValue(listing());
  });

  it('shows each connection with its status and the permissions it granted', async () => {
    renderAt('/connections');

    const list = await screen.findByRole('list', { name: 'Facebook connections' });
    expect(within(list).getByText('Fiona Business')).toBeInTheDocument();
    expect(within(list).getByText('Connected')).toBeInTheDocument();
    expect(within(list).queryByText(/Missing permissions/)).not.toBeInTheDocument();

    const permissions = within(list).getByRole('list', { name: 'Permissions' });
    expect(within(permissions).getAllByRole('listitem')).toHaveLength(5);
    expect(permissions).toHaveTextContent('leads_retrieval');
    expect(within(permissions).queryByText('Missing')).not.toBeInTheDocument();
  });

  it('warns when a permission needed for leads was not granted', async () => {
    facebookService.fetchConnections.mockResolvedValue(
      listing({
        connections: [
          connection({
            grantedScopes: required.filter((scope) => scope !== 'leads_retrieval'),
            missingScopes: ['leads_retrieval'],
          }),
        ],
      }),
    );
    renderAt('/connections');

    expect(await screen.findByText(/Missing permissions: leads_retrieval/)).toBeInTheDocument();
    const permissions = screen.getByRole('list', { name: 'Permissions' });
    expect(within(permissions).getByText('Missing')).toBeInTheDocument();
  });

  it('flags a connection whose Facebook data access is about to end', async () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    facebookService.fetchConnections.mockResolvedValue(
      listing({ connections: [connection({ dataAccessExpiresAt: soon })] }),
    );
    renderAt('/connections');

    expect(await screen.findByText(/data access ends in 5 days/)).toBeInTheDocument();
  });

  it('explains an expired connection and offers to reconnect', async () => {
    facebookService.startConnect.mockResolvedValue('https://www.facebook.com/dialog/oauth?x=1');
    facebookService.fetchConnections.mockResolvedValue(
      listing({
        connections: [
          connection({
            status: 'expired',
            statusReason: 'Session has expired',
            grantedScopes: [],
            missingScopes: required,
          }),
        ],
      }),
    );
    const user = userEvent.setup();
    renderAt('/connections');

    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.getByText(/Session has expired/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-check' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reconnect' }));

    expect(redirectTo).toHaveBeenCalledWith('https://www.facebook.com/dialog/oauth?x=1');
  });

  it('sends the browser to Facebook when Connect Facebook is clicked', async () => {
    facebookService.startConnect.mockResolvedValue(
      'https://www.facebook.com/v25.0/dialog/oauth?s=1',
    );
    const user = userEvent.setup();
    renderAt('/connections');

    await user.click(await screen.findByRole('button', { name: 'Connect Facebook' }));

    expect(facebookService.startConnect).toHaveBeenCalledTimes(1);
    expect(redirectTo).toHaveBeenCalledWith('https://www.facebook.com/v25.0/dialog/oauth?s=1');
  });

  it('shows an error and stays put when the connection cannot be started', async () => {
    facebookService.startConnect.mockRejectedValue(
      apiError(503, {
        code: 'FACEBOOK_NOT_CONFIGURED',
        message: 'Facebook integration is not configured',
      }),
    );
    const user = userEvent.setup();
    renderAt('/connections');

    await user.click(await screen.findByRole('button', { name: 'Connect Facebook' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('not configured');
    expect(redirectTo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Connect Facebook' })).toBeEnabled();
  });

  it('says so, and hides the connect button, when Facebook is not configured', async () => {
    facebookService.fetchConnections.mockResolvedValue(
      listing({ configured: false, connections: [] }),
    );
    renderAt('/connections');

    expect(await screen.findByText(/not configured on this server yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Facebook' })).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing is connected', async () => {
    facebookService.fetchConnections.mockResolvedValue(listing({ connections: [] }));
    renderAt('/connections');

    expect(await screen.findByText('No Facebook account connected yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Facebook' })).toBeInTheDocument();
  });

  it('is read-only for plain members', async () => {
    signInAs('member');
    renderAt('/connections');

    expect(await screen.findByText('Fiona Business')).toBeInTheDocument();
    expect(screen.getByText(/Only workspace owners and admins/)).toBeInTheDocument();
    for (const name of ['Connect Facebook', 'Re-check', 'Disconnect', 'Reconnect']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('re-checks a connection and refreshes the list', async () => {
    facebookService.recheckConnection.mockResolvedValue(connection());
    const user = userEvent.setup();
    renderAt('/connections');

    await user.click(await screen.findByRole('button', { name: 'Re-check' }));

    expect(facebookService.recheckConnection).toHaveBeenCalledWith('c1');
    await waitFor(() => expect(facebookService.fetchConnections).toHaveBeenCalledTimes(2));
  });

  it('shows why a re-check failed', async () => {
    facebookService.recheckConnection.mockRejectedValue(
      apiError(502, {
        code: 'FACEBOOK_ERROR',
        message: 'Facebook could not complete the request.',
      }),
    );
    const user = userEvent.setup();
    renderAt('/connections');

    await user.click(await screen.findByRole('button', { name: 'Re-check' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Facebook could not complete');
  });

  it('asks for confirmation before disconnecting, and lets the user back out', async () => {
    const user = userEvent.setup();
    renderAt('/connections');

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(screen.getByText(/Disconnect Fiona Business\?/)).toBeInTheDocument();
    expect(facebookService.disconnectConnection).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/Disconnect Fiona Business\?/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('disconnects after confirmation and shows the updated list', async () => {
    facebookService.disconnectConnection.mockResolvedValue();
    facebookService.fetchConnections
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(listing({ connections: [] }));
    const user = userEvent.setup();
    renderAt('/connections');

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await user.click(screen.getByRole('button', { name: 'Yes, disconnect' }));

    expect(facebookService.disconnectConnection).toHaveBeenCalledWith('c1');
    expect(await screen.findByText('No Facebook account connected yet')).toBeInTheDocument();
  });

  it('confirms a successful connection after returning from Facebook, then clears the URL', async () => {
    renderAt('/connections?facebook=connected');

    expect(await screen.findByText('Facebook account connected.')).toBeInTheDocument();
  });

  it.each([
    ['denied', /access was not granted/],
    ['state', /expired or was opened in a different browser/],
    ['exchange', /did not accept the login/],
    ['unavailable', /could not be reached/],
    ['something-new', /Something went wrong while connecting/],
  ])('explains a failed login (%s)', async (reason, message) => {
    renderAt(`/connections?facebook=error&reason=${reason}`);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('offers a retry when the connections cannot be loaded', async () => {
    facebookService.fetchConnections
      .mockRejectedValueOnce(
        apiError(500, { code: 'INTERNAL_ERROR', message: 'Something went wrong' }),
      )
      .mockResolvedValueOnce(listing());
    const user = userEvent.setup();
    renderAt('/connections');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Fiona Business')).toBeInTheDocument();
  });
});

describe('facebook pages page', () => {
  const connection = (id, overrides = {}) => ({
    id,
    facebookUserId: `fb-${id}`,
    name: `Account ${id}`,
    status: 'active',
    statusReason: null,
    grantedScopes: [],
    missingScopes: [],
    tokenExpiresAt: null,
    dataAccessExpiresAt: null,
    lastVerifiedAt: null,
    connectedAt: '2026-10-30T10:00:00.000Z',
    connectedBy: 'u1',
    ...overrides,
  });
  const connections = (...list) => ({ configured: true, requiredScopes: [], connections: list });
  const page = (overrides = {}) => ({
    id: 'p1',
    pageId: '111',
    connectionId: 'c1',
    name: 'Acme Realty',
    category: 'Real Estate',
    pictureUrl: 'https://cdn.example/111.jpg',
    tasks: ['ADVERTISE', 'MANAGE'],
    status: 'active',
    statusReason: null,
    tokenExpiresAt: null,
    lastVerifiedAt: '2026-11-01T10:00:00.000Z',
    webhook: {
      subscribed: true,
      subscribedAt: '2026-11-01T09:00:00.000Z',
      error: null,
      lastEventAt: null,
    },
    connectedAt: '2026-10-31T10:00:00.000Z',
    connectedBy: 'u1',
    ...overrides,
  });
  const available = (overrides = {}) => ({
    pageId: '222',
    name: 'Acme Autos',
    category: 'Car Dealership',
    pictureUrl: null,
    tasks: ['ADVERTISE'],
    canRetrieveLeads: true,
    connected: false,
    inUseElsewhere: false,
    ...overrides,
  });
  const signInAs = (role) =>
    authService.restoreSession.mockResolvedValue({
      ...session,
      user: { ...session.user, role },
    });

  beforeEach(() => {
    signInAs('owner');
    facebookService.fetchConnections.mockResolvedValue(connections(connection('c1')));
    facebookService.fetchPages.mockResolvedValue([page()]);
    facebookService.fetchAvailablePages.mockResolvedValue([available()]);
  });

  it('lists the connected Pages with their details', async () => {
    renderAt('/pages');

    const list = await screen.findByRole('list', { name: 'Connected Pages' });
    expect(within(list).getByText('Acme Realty')).toBeInTheDocument();
    expect(within(list).getByText(/Page ID 111/)).toHaveTextContent('Real Estate');
    expect(within(list).getByText('Connected')).toBeInTheDocument();
    expect(list.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/111.jpg');
  });

  it('shows the Page’s initials when it has no picture', async () => {
    facebookService.fetchPages.mockResolvedValue([page({ pictureUrl: null })]);
    renderAt('/pages');

    const list = await screen.findByRole('list', { name: 'Connected Pages' });
    expect(within(list).getByText('AR')).toBeInTheDocument();
    expect(list.querySelector('img')).toBeNull();
  });

  it('has an empty state that points an admin to the add section', async () => {
    facebookService.fetchPages.mockResolvedValue([]);
    renderAt('/pages');

    expect(await screen.findByText(/No Pages connected yet\. Add one below\./)).toBeInTheDocument();
  });

  it('offers the Pages Facebook says the account manages, and connects the chosen one', async () => {
    facebookService.connectPage.mockResolvedValue(page({ pageId: '222', name: 'Acme Autos' }));
    const user = userEvent.setup();
    renderAt('/pages');

    const list = await screen.findByRole('list', { name: 'Available Pages' });
    expect(within(list).getByText('Acme Autos')).toBeInTheDocument();
    expect(facebookService.fetchAvailablePages).toHaveBeenCalledWith('c1');

    await user.click(within(list).getByRole('button', { name: 'Connect Acme Autos' }));

    expect(facebookService.connectPage).toHaveBeenCalledWith({
      connectionId: 'c1',
      pageId: '222',
    });
    await waitFor(() => expect(facebookService.fetchPages).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(facebookService.fetchAvailablePages).toHaveBeenCalledTimes(2));
  });

  it('labels Pages that are already connected or used elsewhere, and warns about missing access', async () => {
    facebookService.fetchAvailablePages.mockResolvedValue([
      available({ pageId: '1', name: 'Mine', connected: true }),
      available({ pageId: '2', name: 'Taken', inUseElsewhere: true }),
      available({ pageId: '3', name: 'No Access', canRetrieveLeads: false }),
    ]);
    renderAt('/pages');

    const list = await screen.findByRole('list', { name: 'Available Pages' });
    expect(within(list).getByText('Connected')).toBeInTheDocument();
    expect(within(list).getByText('Used by another workspace')).toBeInTheDocument();
    expect(within(list).getByText(/No Advertiser access/)).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Connect Mine' })).not.toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Connect Taken' })).not.toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Connect No Access' })).toBeInTheDocument();
  });

  it('lets the admin pick which Facebook account to list Pages from', async () => {
    facebookService.fetchConnections.mockResolvedValue(
      connections(connection('c1'), connection('c2')),
    );
    const user = userEvent.setup();
    renderAt('/pages');

    await user.selectOptions(await screen.findByLabelText('Facebook account'), 'c2');

    await waitFor(() => expect(facebookService.fetchAvailablePages).toHaveBeenCalledWith('c2'));
  });

  it('shows the reason a connection error happened and reloads the choices', async () => {
    facebookService.connectPage.mockRejectedValue(
      apiError(409, {
        code: 'PAGE_IN_USE',
        message: 'This Page is already connected to another LeadSync workspace.',
      }),
    );
    const user = userEvent.setup();
    renderAt('/pages');

    await user.click(await screen.findByRole('button', { name: 'Connect Acme Autos' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already connected to another');
    await waitFor(() => expect(facebookService.fetchAvailablePages).toHaveBeenCalledTimes(2));
  });

  it('offers a retry when the available Pages cannot be loaded', async () => {
    facebookService.fetchAvailablePages
      .mockRejectedValueOnce(
        apiError(502, {
          code: 'FACEBOOK_ERROR',
          message: 'Facebook could not complete the request.',
        }),
      )
      .mockResolvedValueOnce([available()]);
    const user = userEvent.setup();
    renderAt('/pages');

    expect(await screen.findByRole('alert')).toHaveTextContent('Facebook could not complete');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('list', { name: 'Available Pages' })).toBeInTheDocument();
  });

  it('explains a Page that lost its access and points to the connection', async () => {
    facebookService.fetchPages.mockResolvedValue([
      page({ status: 'invalid', statusReason: 'The Facebook connection needs to be reconnected' }),
    ]);
    renderAt('/pages');

    expect(await screen.findByText('Needs reconnecting')).toBeInTheDocument();
    expect(screen.getByText(/needs to be reconnected/)).toBeInTheDocument();
    const link = screen.getAllByRole('link', { name: 'Connections page' })[0];
    expect(link).toHaveAttribute('href', '/connections');
  });

  describe('new-lead notifications', () => {
    const webhook = (overrides = {}) => ({
      subscribed: true,
      subscribedAt: '2026-11-01T09:00:00.000Z',
      error: null,
      lastEventAt: null,
      ...overrides,
    });

    it('shows that new leads arrive automatically, and when the last one did', async () => {
      facebookService.fetchPages.mockResolvedValue([
        page({ webhook: webhook({ lastEventAt: '2026-11-01T09:30:00.000Z' }) }),
      ]);
      renderAt('/pages');

      expect(await screen.findByText('Receiving new leads automatically')).toBeInTheDocument();
      expect(screen.getByText(/Last new lead/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
    });

    it('says none have arrived yet for a Page that was only just subscribed', async () => {
      renderAt('/pages');

      expect(await screen.findByText('No new leads have arrived yet.')).toBeInTheDocument();
    });

    it('explains why a Page is not receiving leads, and lets an admin subscribe it', async () => {
      facebookService.fetchPages.mockResolvedValue([
        page({
          webhook: webhook({
            subscribed: false,
            error: 'Facebook would not let LeadSync subscribe to new leads for this Page.',
          }),
        }),
      ]);
      facebookService.subscribePage.mockResolvedValue(page());
      const user = userEvent.setup();
      renderAt('/pages');

      expect(await screen.findByText('Not receiving new leads automatically')).toBeInTheDocument();
      expect(screen.getByText(/would not let LeadSync subscribe/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Subscribe' }));

      expect(facebookService.subscribePage).toHaveBeenCalledWith('111');
      await waitFor(() => expect(facebookService.fetchPages).toHaveBeenCalledTimes(2));
    });

    it('points to manual syncing when nothing specific went wrong', async () => {
      facebookService.fetchPages.mockResolvedValue([
        page({ webhook: webhook({ subscribed: false }) }),
      ]);
      renderAt('/pages');

      expect(
        await screen.findByText(/You can still pull leads with Sync leads/),
      ).toBeInTheDocument();
    });

    it('shows why subscribing failed', async () => {
      facebookService.fetchPages.mockResolvedValue([
        page({ webhook: webhook({ subscribed: false }) }),
      ]);
      facebookService.subscribePage.mockRejectedValue(
        apiError(502, {
          code: 'WEBHOOK_SUBSCRIPTION_FAILED',
          message: 'Check that the Meta app has the pages_manage_metadata permission.',
        }),
      );
      const user = userEvent.setup();
      renderAt('/pages');

      await user.click(await screen.findByRole('button', { name: 'Subscribe' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('pages_manage_metadata');
    });

    it('lets plain members see the status but not change it', async () => {
      signInAs('member');
      facebookService.fetchPages.mockResolvedValue([
        page({ webhook: webhook({ subscribed: false }) }),
      ]);
      renderAt('/pages');

      expect(await screen.findByText('Not receiving new leads automatically')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
    });

    it('does not show the status for a Page that needs reconnecting', async () => {
      facebookService.fetchPages.mockResolvedValue([
        page({
          status: 'invalid',
          statusReason: 'The Facebook connection needs to be reconnected',
        }),
      ]);
      renderAt('/pages');

      expect(await screen.findByText('Needs reconnecting')).toBeInTheDocument();
      expect(screen.queryByText(/new leads automatically/)).not.toBeInTheDocument();
    });
  });

  it('warns when the user lacks Advertiser access on a connected Page', async () => {
    facebookService.fetchPages.mockResolvedValue([page({ tasks: ['MANAGE'] })]);
    renderAt('/pages');

    expect(await screen.findByText(/does not have Advertiser access/)).toBeInTheDocument();
  });

  it('re-checks a Page and refreshes the list', async () => {
    facebookService.recheckPage.mockResolvedValue(page());
    const user = userEvent.setup();
    renderAt('/pages');

    await user.click(await screen.findByRole('button', { name: 'Re-check' }));

    expect(facebookService.recheckPage).toHaveBeenCalledWith('111');
    await waitFor(() => expect(facebookService.fetchPages).toHaveBeenCalledTimes(2));
  });

  it('asks before disconnecting a Page, then removes it', async () => {
    facebookService.disconnectPage.mockResolvedValue();
    facebookService.fetchPages.mockResolvedValueOnce([page()]).mockResolvedValueOnce([]);
    const user = userEvent.setup();
    renderAt('/pages');

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(screen.getByText(/Disconnect Acme Realty\?/)).toBeInTheDocument();
    expect(facebookService.disconnectPage).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Yes, disconnect' }));

    expect(facebookService.disconnectPage).toHaveBeenCalledWith('111');
    expect(await screen.findByText(/No Pages connected yet/)).toBeInTheDocument();
  });

  it('is read-only for plain members and never asks Facebook for Pages', async () => {
    signInAs('member');
    renderAt('/pages');

    expect(await screen.findByText('Acme Realty')).toBeInTheDocument();
    for (const name of ['Re-check', 'Disconnect']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Add a Page')).not.toBeInTheDocument();
    expect(facebookService.fetchAvailablePages).not.toHaveBeenCalled();
  });

  it('asks for a Facebook account first when none is connected', async () => {
    facebookService.fetchConnections.mockResolvedValue(connections());
    renderAt('/pages');

    expect(await screen.findByText(/Connect a Facebook account first/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connections page' })).toHaveAttribute(
      'href',
      '/connections',
    );
    expect(facebookService.fetchAvailablePages).not.toHaveBeenCalled();
  });

  it('asks the admin to reconnect when no Facebook account is usable', async () => {
    facebookService.fetchConnections.mockResolvedValue(
      connections(connection('c1', { status: 'expired' })),
    );
    renderAt('/pages');

    expect(await screen.findByText(/connection needs attention/)).toBeInTheDocument();
    expect(facebookService.fetchAvailablePages).not.toHaveBeenCalled();
  });

  it('says so when Facebook is not configured on the server', async () => {
    facebookService.fetchConnections.mockResolvedValue({
      configured: false,
      requiredScopes: [],
      connections: [],
    });
    renderAt('/pages');

    expect(await screen.findByText(/not configured on this server yet/)).toBeInTheDocument();
  });

  it('offers a retry when the connected Pages cannot be loaded', async () => {
    facebookService.fetchPages
      .mockRejectedValueOnce(
        apiError(500, { code: 'INTERNAL_ERROR', message: 'Something went wrong' }),
      )
      .mockResolvedValueOnce([page()]);
    const user = userEvent.setup();
    renderAt('/pages');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    await user.click(screen.getAllByRole('button', { name: 'Try again' })[0]);

    expect(await screen.findByText('Acme Realty')).toBeInTheDocument();
  });
});
