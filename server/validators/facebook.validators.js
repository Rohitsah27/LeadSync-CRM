import { z } from 'zod';

export const connectPageSchema = z.object({
  connectionId: z
    .string({ error: 'Connection is required' })
    .regex(/^[0-9a-f]{24}$/i, 'Invalid connection'),
  pageId: z.string({ error: 'Page is required' }).regex(/^\d+$/, 'Invalid Page'),
});
