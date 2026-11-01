import { fetchMembers } from '../services/workspace.js';
import { useAsyncData } from './useAsyncData.js';

export function useMembers() {
  const { status, data, error, reload } = useAsyncData(fetchMembers);
  return { status, members: data ?? [], error, reload };
}
