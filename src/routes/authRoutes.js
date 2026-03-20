import express from 'express';
import { googleAuthCallback, refreshToken, getUserCalendars, getCalendarEvents } from '../controllers/authController.js';

const router = express.Router();

// POST /api/auth/google
// Receives the code from the frontend, gets tokens, saves refresh token to Firebase DB
router.post('/google', googleAuthCallback);

// POST /api/auth/refresh
// When frontend gets a 401, it calls this to get a new access_token using the DB refresh token
router.post('/refresh', refreshToken);

// GET /api/auth/calendars/:userId
// Fetch all connected calendars for a specific user
router.get('/calendars/:userId', getUserCalendars);

// GET /api/auth/events/:calendarId
// Fetch events for a specific calendar. Optional generic ?date=YYYY-MM-DD
router.get('/events/:calendarId', getCalendarEvents);

export default router;
