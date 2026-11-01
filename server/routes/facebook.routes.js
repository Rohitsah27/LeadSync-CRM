import express, { Router } from 'express';
import {
  checkConnection,
  connectFacebook,
  deauthorize,
  disconnectFacebook,
  listFacebookConnections,
  oauthCallback,
} from '../controllers/facebook.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import { requireFacebookConfigured } from '../middleware/requireFacebookConfigured.js';

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

export default router;
