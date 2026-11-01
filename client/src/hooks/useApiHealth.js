import { isCancel } from 'axios';
import { useEffect, useState } from 'react';
import { fetchHealth } from '../services/health.js';

/** Returns 'checking' | 'online' | 'offline' for the backend health endpoint. */
export function useApiHealth() {
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    const controller = new AbortController();

    fetchHealth({ signal: controller.signal })
      .then(() => setStatus('online'))
      .catch((error) => {
        if (!isCancel(error)) setStatus('offline');
      });

    return () => controller.abort();
  }, []);

  return status;
}
