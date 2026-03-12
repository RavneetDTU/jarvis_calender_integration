import express from 'express';
import { googleAuthCallback, refreshToken } from '../controllers/authController.js';

const router = express.Router();

// POST /api/auth/google
// Receives the code from the frontend, gets tokens, saves refresh token to Firebase DB
router.post('/google', googleAuthCallback);

// POST /api/auth/refresh
// When frontend gets a 401, it calls this to get a new access_token using the DB refresh token
router.post('/refresh', refreshToken);

export default router;
