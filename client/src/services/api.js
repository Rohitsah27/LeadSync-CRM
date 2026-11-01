import axios from 'axios';
import { API_URL } from '../utils/config.js';

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 15_000,
  headers: { Accept: 'application/json' },
});
