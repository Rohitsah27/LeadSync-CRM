import { useCallback, useEffect, useState } from 'react';
import { fetchMembers } from '../services/workspace.js';
import { getErrorMessage } from '../utils/errors.js';

/** Loads the workspace's team. `status` is 'loading' | 'ready' | 'error'. */
export function useMembers() {
  const [state, setState] = useState({ status: 'loading', members: [], error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    fetchMembers().then(
      (members) => active && setState({ status: 'ready', members, error: null }),
      (error) =>
        active && setState({ status: 'error', members: [], error: getErrorMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, status: 'loading', error: null }));
    setAttempt((count) => count + 1);
  }, []);

  return { ...state, reload };
}
