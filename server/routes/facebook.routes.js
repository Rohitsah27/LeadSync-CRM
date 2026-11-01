import express, { Router } from 'express';
import {
  checkConnection,
  checkFacebookPage,
  connectFacebook,
  connectFacebookPage,
  deauthorize,
  disconnectFacebook,
  disconnectFacebookPage,
  listAvailableFacebookPages,
  listFacebookConnections,
  listFacebookPages,
  oauthCallback,
  subscribeFacebookPage,
} from '../controllers/facebook.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import { requireFacebookConfigured } from '../middleware/requireFacebookConfigured.js';
import { validateBody } from '../middleware/validate.js';
import { connectPageSchema } from '../validators/facebook.validators.js';

const router = Router();

// Called by Facebook, not by the app: they authenticate through the state cookie and the signed
// request instead of a Bearer token.
router.get('/oauth/callback', oauthCallback);
router.post(
  '/deauthorize',
  express.urlencoded({ extended: false, limit: '10kb' }),
  requireFacebookConfigured(),
  deauthorize,
);

router.use(requireAuth);

router.get('/connections', listFacebookConnections);
router.post('/connect', requireRole('admin'), requireFacebookConfigured(), connectFacebook);
router.post(
  '/connections/:connectionId/check',
  requireRole('admin'),
  requireFacebookConfigured(),
  checkConnection,
);
router.delete('/connections/:connectionId', requireRole('admin'), disconnectFacebook);

// Pages. Choosing which Pages feed the workspace is an admin task; anyone can see the result.
router.get('/pages', listFacebookPages);
router.get(
  '/connections/:connectionId/pages',
  requireRole('admin'),
  requireFacebookConfigured(),
  listAvailableFacebookPages,
);
router.post(
  '/pages',
  requireRole('admin'),
  requireFacebookConfigured(),
  validateBody(connectPageSchema),
  connectFacebookPage,
);
router.post(
  '/pages/:pageId/check',
  requireRole('admin'),
  requireFacebookConfigured(),
  checkFacebookPage,
);
router.post(
  '/pages/:pageId/subscription',
  requireRole('admin'),
  requireFacebookConfigured(),
  subscribeFacebookPage,
);
router.delete('/pages/:pageId', requireRole('admin'), disconnectFacebookPage);

export default router;
