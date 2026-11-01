import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '../utils/errors.js';

/**
 * Loads data once and again on `reload()`. `status` is 'loading' | 'ready' | 'error'.
 * Pass a stable function (a module-level import), since a new function each render would reload.
 */
export function useAsyncData(loader) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loader().then(
      (data) => active && setState({ status: 'ready', data, error: null }),
      (error) => active && setState({ status: 'error', data: null, error: getErrorMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, [loader, attempt]);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, status: 'loading', error: null }));
    setAttempt((count) => count + 1);
  }, []);

  return { ...state, reload };
}
