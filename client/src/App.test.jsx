import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import AuthProvider from './context/AuthProvider.jsx';
import * as authService from './services/auth.js';
import { fetchHealth } from './services/health.js';

vi.mock('./services/auth.js');
vi.mock('./services/health.js');

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
    renderAt('/leads/abc123');

    expect(await screen.findByRole('heading', { name: 'Lead Details' })).toBeInTheDocument();
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
