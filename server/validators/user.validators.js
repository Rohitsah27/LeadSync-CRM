import { z } from 'zod';
import { passwordField, personNameField } from './auth.validators.js';

export const updateProfileSchema = z.object({
  name: personNameField,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ error: 'Current password is required' })
      .min(1, 'Current password is required')
      .max(1024),
    newPassword: passwordField,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  });
