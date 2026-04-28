import express from 'express';
import { bookEvent } from '../controllers/calendarController.js';

const router = express.Router();

// POST /api/calendar/book-event
// Books a Google Calendar event for a lead — same process as the "Book Event" tab in the leads modal
router.post('/book-event', bookEvent);

export default router;
