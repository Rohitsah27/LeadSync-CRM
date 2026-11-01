import { Router } from 'express';
import { login, logout, logoutAll, refresh, register } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { loginLimiter, registerLimiter } from '../middleware/rateLimit.js';
import { requireAllowedOrigin } from '../middleware/requireAllowedOrigin.js';
import { validateBody } from '../middleware/validate.js';
import { loginSchema, registerSchema } from '../validators/auth.validators.js';

const router = Router();

router.post('/register', registerLimiter, validateBody(registerSchema), register);
router.post('/login', loginLimiter, validateBody(loginSchema), login);
router.post('/refresh', requireAllowedOrigin, refresh);
router.post('/logout', requireAllowedOrigin, logout);
router.post('/logout-all', requireAuth, logoutAll);

export default router;
