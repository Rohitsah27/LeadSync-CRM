import { fetchConnections } from '../services/facebook.js';
import { useAsyncData } from './useAsyncData.js';

export function useConnections() {
  const { status, data, error, reload } = useAsyncData(fetchConnections);
  return {
    status,
    configured: data?.configured ?? true,
    requiredScopes: data?.requiredScopes ?? [],
    connections: data?.connections ?? [],
    error,
    reload,
  };
}
