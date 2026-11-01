import { Router } from 'express';
import { getMe, updateMe, updateMyPassword } from '../controllers/user.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { changePasswordSchema, updateProfileSchema } from '../validators/user.validators.js';

const router = Router();

router.use(requireAuth);

router.get('/me', getMe);
router.patch('/me', validateBody(updateProfileSchema), updateMe);
router.post('/me/password', validateBody(changePasswordSchema), updateMyPassword);

export default router;
