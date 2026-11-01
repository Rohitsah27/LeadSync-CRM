import express, { Router } from 'express';
import { requireFacebookConfigured } from '../middleware/requireFacebookConfigured.js';
import { receive, verifyChallenge } from './meta.controller.js';

const router = Router();

router.use(requireFacebookConfigured());

router.get('/', verifyChallenge);
// The signature covers the exact bytes Meta sent, so this route reads the raw body.
router.post('/', express.raw({ type: 'application/json', limit: '1mb' }), receive);

export default router;
