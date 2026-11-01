import { Router } from 'express';
import { runLeadSync, showLead, showLeads } from '../controllers/lead.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import { requireFacebookConfigured } from '../middleware/requireFacebookConfigured.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { listLeadsQuery, syncLeadsBody } from '../validators/lead.validators.js';

const router = Router();

router.use(requireAuth);

router.get('/', validateQuery(listLeadsQuery), showLeads);
// Registered before `/:leadId` so "sync" is not read as a lead id.
router.post(
  '/sync',
  requireRole('admin'),
  requireFacebookConfigured(),
  validateBody(syncLeadsBody),
  runLeadSync,
);
router.get('/:leadId', showLead);

export default router;
