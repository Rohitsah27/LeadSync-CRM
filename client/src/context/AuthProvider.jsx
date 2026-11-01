import { useMemo, useState } from 'react';
import { AuthContext } from './authContext.js';

// Skeleton: session handling (login, refresh, logout) arrives in Phase 2.
export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  const value = useMemo(() => ({ user, isAuthenticated: Boolean(user), setUser }), [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
