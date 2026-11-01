import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import App from '../App.jsx';
import AuthProvider from '../context/AuthProvider.jsx';

/** A signed-in owner, as the auth service returns it. */
export const session = {
  user: {
    id: 'u1',
    name: 'Asha Rao',
    email: 'asha@example.com',
    role: 'owner',
    workspaceId: 'w1',
  },
  workspace: { id: 'w1', name: 'Rao Realty' },
};

/** An error shaped like the ones the API client throws. */
export function apiError(status, error) {
  return Object.assign(new Error('Request failed'), { response: { status, data: { error } } });
}

/** Renders the whole app at a path. Test files mock the services they need. */
export function renderAt(path) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  );
}
