import { fetchPages } from '../services/facebook.js';
import { useAsyncData } from './useAsyncData.js';

export function usePages() {
  const { status, data, error, reload } = useAsyncData(fetchPages);
  return { status, pages: data ?? [], error, reload };
}
