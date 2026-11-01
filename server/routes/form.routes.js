import { Router } from 'express';
import { refreshForms, showForms, updateForm } from '../controllers/form.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import { requireFacebookConfigured } from '../middleware/requireFacebookConfigured.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { listFormsQuery, syncFormsBody, updateFormBody } from '../validators/lead.validators.js';

const router = Router();

router.use(requireAuth);

router.get('/', validateQuery(listFormsQuery), showForms);
router.post(
  '/sync',
  requireRole('admin'),
  requireFacebookConfigured(),
  validateBody(syncFormsBody),
  refreshForms,
);
router.patch('/:formId', requireRole('admin'), validateBody(updateFormBody), updateForm);

export default router;
