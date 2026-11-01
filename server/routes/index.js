import { Router } from 'express';
import authRoutes from './auth.routes.js';
import facebookRoutes from './facebook.routes.js';
import formRoutes from './form.routes.js';
import leadRoutes from './lead.routes.js';
import healthRoutes from './health.routes.js';
import userRoutes from './user.routes.js';
import workspaceRoutes from './workspace.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/workspace', workspaceRoutes);
router.use('/facebook', facebookRoutes);
router.use('/forms', formRoutes);
router.use('/leads', leadRoutes);

export default router;
