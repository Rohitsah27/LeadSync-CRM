import { z } from 'zod';
import { businessNameField } from './auth.validators.js';

export const updateWorkspaceSchema = z.object({
  name: businessNameField,
});
