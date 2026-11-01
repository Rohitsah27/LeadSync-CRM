import { Router } from 'express';
import {
  showMember,
  showMembers,
  showWorkspace,
  updateWorkspace,
} from '../controllers/workspace.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import { updateWorkspaceSchema } from '../validators/workspace.validators.js';

const router = Router();

router.use(requireAuth);

router.get('/', showWorkspace);
router.patch('/', requireRole('admin'), validateBody(updateWorkspaceSchema), updateWorkspace);
router.get('/members', showMembers);
router.get('/members/:userId', showMember);

export default router;
