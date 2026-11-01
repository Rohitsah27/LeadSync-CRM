import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import AuthProvider from './context/AuthProvider.jsx';
import { fetchHealth } from './services/health.js';

vi.mock('./services/health.js', () => ({ fetchHealth: vi.fn() }));

function renderAt(path) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('App routing', () => {
  it('renders the dashboard with every primary navigation section', async () => {
    fetchHealth.mockResolvedValue({ status: 'ok' });
    renderAt('/');

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
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

  it('renders auth pages inside the auth layout without the dashboard navigation', () => {
    renderAt('/login');

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });

  it('renders the lead details route', () => {
    fetchHealth.mockResolvedValue({ status: 'ok' });
    renderAt('/leads/abc123');

    expect(screen.getByRole('heading', { name: 'Lead Details' })).toBeInTheDocument();
  });

  it('renders a not-found page for unknown routes', () => {
    fetchHealth.mockResolvedValue({ status: 'ok' });
    renderAt('/does-not-exist');

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
