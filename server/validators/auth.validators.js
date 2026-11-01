import { z } from 'zod';

// bcrypt ignores everything after 72 bytes, so longer passwords would be silently truncated.
const MAX_PASSWORD_BYTES = 72;

export const emailField = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

export const passwordField = z
  .string({ error: 'Password is required' })
  .min(10, 'Use at least 10 characters')
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES,
    'Password is too long',
  );

export const personNameField = z
  .string({ error: 'Name is required' })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(80, 'Name must be at most 80 characters');

export const businessNameField = z
  .string({ error: 'Business name is required' })
  .trim()
  .min(2, 'Business name must be at least 2 characters')
  .max(100, 'Business name must be at most 100 characters');

export const registerSchema = z.object({
  name: personNameField,
  businessName: businessNameField,
  email: emailField,
  password: passwordField,
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(1024),
});
