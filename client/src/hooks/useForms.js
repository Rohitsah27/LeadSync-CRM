import { fetchForms } from '../services/leads.js';
import { useAsyncData } from './useAsyncData.js';

export function useForms() {
  const { status, data, error, reload } = useAsyncData(fetchForms);
  return { status, forms: data ?? [], error, reload };
}
