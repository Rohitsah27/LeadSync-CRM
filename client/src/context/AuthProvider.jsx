import { useCallback, useEffect, useMemo, useState } from 'react';
import { onSessionExpired } from '../services/api.js';
import * as authService from '../services/auth.js';
import { AuthContext } from './authContext.js';

const SIGNED_OUT = { status: 'unauthenticated', user: null, workspace: null };

export default function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, workspace: null });

  const startSession = useCallback(
    ({ user, workspace }) => setState({ status: 'authenticated', user, workspace }),
    [],
  );
  const endSession = useCallback(() => setState(SIGNED_OUT), []);

  useEffect(() => {
    let active = true;
    authService.restoreSession().then(
      (session) => active && startSession(session),
      () => active && endSession(),
    );
    return () => {
      active = false;
    };
  }, [startSession, endSession]);

  useEffect(() => {
    onSessionExpired(endSession);
    return () => onSessionExpired(null);
  }, [endSession]);

  const value = useMemo(
    () => ({
      ...state,
      isAuthenticated: state.status === 'authenticated',
      signIn: async (credentials) => startSession(await authService.login(credentials)),
      signUp: async (details) => startSession(await authService.register(details)),
      signOut: async () => {
        try {
          await authService.logout();
        } finally {
          endSession();
        }
      },
      signOutEverywhere: async () => {
        await authService.logoutAllDevices();
        endSession();
      },
      changePassword: async (values) => startSession(await authService.changePassword(values)),
      updateProfile: async (values) => {
        const user = await authService.updateProfile(values);
        setState((current) => ({ ...current, user }));
      },
    }),
    [state, startSession, endSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
