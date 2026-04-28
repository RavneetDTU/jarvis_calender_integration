import { db } from '../config/auth.js';
import { google } from 'googleapis';

// ── Mirror of frontend constants.js EVENT_TYPES ─────────────────────────────
const EVENT_TYPES = [
    { value: 'hearing-aid-test', label: 'Hearing Aid Test', duration: 45 },
    { value: 'wax-removal',      label: 'Wax Removal Test', duration: 30 },
];

// ── Wax-removal custom message (same text as BookEventTab.jsx) ───────────────
function buildWaxRemovalMessage(eventDate, startTime) {
    const [hourStr, minuteStr] = startTime.split(':');
    const hour = parseInt(hourStr, 10);
    const ampm = hour >= 12 ? 'pm' : 'am';
    const formattedHour = hour % 12 || 12;
    const formattedTime = `${formattedHour}:${minuteStr}${ampm}`;
    const appointmentTime = `${eventDate} at ${formattedTime}`;

    return `Good Day,

Thank you for booking your ear wax removal appointment with us.
Your appointment has been confirmed for ${appointmentTime}
 
The cost is R200.00 per ear or R400.00 for both ears.
 
We will first examine your ears to check for wax and make sure it is safe to proceed. If suitable, we will gently remove the wax using a cleaning solution and specialised equipment. Once the procedure is complete, we will re-examine your ears to ensure they are fully clear.
 
We are located in Checkers Hyper in Blue Route Mall (corner of Vans Road & Tokai Road), opposite teller number 15/16. As you enter the checkers hyper you will see shops along the left we are the 4th Shop.
Pin Location : https://goo.gl/maps/qpNFizrYWaUnEeQB6
We look forward to meeting you!
If you have any questions, feel free to contact us on the number below.
Hearing Aid Labs Blue Route Mall
Shop –G260
16 Tokai Road, Corner Vans & Tokai Road
Tokai,7945
Phone: 021 110 0275`;
}

/**
 * POST /api/calendar/book-event
 *
 * Books a Google Calendar event for a given store and sends an invite email
 * to the lead — identical to what the BookEventTab does in the frontend.
 *
 * Body:
 * {
 *   "calendarId":     "TOKAI",            // store ID (same key used in Firebase + frontend localStorage)
 *   "eventType":      "hearing-aid-test", // or "wax-removal"
 *   "eventDate":      "2026-05-10",       // YYYY-MM-DD
 *   "startTime":      "10:30",            // HH:MM  (24-hour)
 *   "timeZone":       "Africa/Johannesburg", // optional, defaults to Africa/Johannesburg
 *   "additionalNote": "...",              // optional
 *   "lead": {
 *     "name":  "John Smith",
 *     "phone": "0821234567",
 *     "email": "john@example.com"         // REQUIRED — Google sends invite here
 *   }
 * }
 *
 * Token expiry is handled automatically:
 *   The googleapis library uses the stored refresh_token from Firebase to get a
 *   fresh access_token on every call — no manual refresh needed, no 401 errors.
 */
export const bookEvent = async (req, res) => {
    try {
        const {
            calendarId,
            eventType,
            eventDate,
            startTime,
            timeZone,
            additionalNote,
            lead = {},
        } = req.body;

        const { name, phone, email } = lead;

        // ── 1. Validate required fields ──────────────────────────────────────
        const missing = [];
        if (!calendarId)  missing.push('calendarId');
        if (!eventType)   missing.push('eventType');
        if (!eventDate)   missing.push('eventDate');
        if (!startTime)   missing.push('startTime');
        if (!email)       missing.push('lead.email');

        if (missing.length) {
            return res.status(400).json({
                error: `Missing required fields: ${missing.join(', ')}`,
                required: {
                    calendarId:     'Store ID (e.g. "TOKAI") — must match a connected store in Firebase',
                    eventType:      `One of: ${EVENT_TYPES.map(e => e.value).join(', ')}`,
                    eventDate:      'YYYY-MM-DD',
                    startTime:      'HH:MM  (24-hour format)',
                    'lead.email':   'Email address — Google sends the calendar invite here',
                },
                optional: {
                    'lead.name':    'Patient full name',
                    'lead.phone':   'Patient phone number',
                    timeZone:       'IANA timezone string. Defaults to Africa/Johannesburg',
                    additionalNote: 'Any extra note to include in the event description',
                },
            });
        }

        // ── 2. Validate eventType ────────────────────────────────────────────
        const selectedEvent = EVENT_TYPES.find(e => e.value === eventType);
        if (!selectedEvent) {
            return res.status(400).json({
                error: `Invalid eventType "${eventType}". Valid values: ${EVENT_TYPES.map(e => e.value).join(', ')}`,
            });
        }

        // ── 3. Validate date / time formats ─────────────────────────────────
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (!dateRegex.test(eventDate)) {
            return res.status(400).json({ error: 'eventDate must be in YYYY-MM-DD format (e.g. "2026-05-10")' });
        }
        if (!timeRegex.test(startTime)) {
            return res.status(400).json({ error: 'startTime must be in HH:MM 24-hour format (e.g. "10:30")' });
        }

        if (!db) {
            return res.status(500).json({ error: 'Database not initialized' });
        }

        // ── 4. Load the refresh_token for this store from Firebase ───────────
        const storeDoc = await db.collection('stores').doc(calendarId).get();
        if (!storeDoc.exists) {
            return res.status(404).json({
                error: `No store found with calendarId "${calendarId}". Make sure the store is connected via the Calendar Settings page first.`,
            });
        }

        const storeData = storeDoc.data();
        if (!storeData.refresh_token) {
            return res.status(404).json({
                error: `Store "${calendarId}" exists but has no Google account connected. Please reconnect it via Calendar Settings.`,
            });
        }

        // ── 5. Build a per-request OAuth2 client with the refresh_token ──────
        //    The googleapis library will automatically get a fresh access_token
        //    when making the API call — no token expiry issues, ever.
        const authClient = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            'postmessage'
        );
        authClient.setCredentials({ refresh_token: storeData.refresh_token });

        // ── 6. Compute end time ──────────────────────────────────────────────
        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateObj = new Date(2000, 0, 1, hours, minutes);
        const endDateObj   = new Date(startDateObj.getTime() + selectedEvent.duration * 60_000);
        const endTime = [
            String(endDateObj.getHours()).padStart(2, '0'),
            String(endDateObj.getMinutes()).padStart(2, '0'),
        ].join(':');

        const tz = timeZone || 'Africa/Johannesburg';

        // ── 7. Build event description (mirrors BookEventTab exactly) ────────
        const descriptionParts = [
            `Patient: ${name  || 'N/A'}`,
            `Phone:   ${phone || 'N/A'}`,
            `Email:   ${email}`,
            `Store:   ${storeData.storeName || calendarId}`,
        ];
        if (additionalNote) {
            descriptionParts.push(`\nNote: ${additionalNote}`);
        }
        if (eventType === 'wax-removal') {
            descriptionParts.push(`\n${buildWaxRemovalMessage(eventDate, startTime)}`);
        }

        // ── 8. Build the event payload ───────────────────────────────────────
        const eventPayload = {
            summary:     `${selectedEvent.label} — ${name || 'Patient'}`,
            description: descriptionParts.join('\n'),
            start:       { dateTime: `${eventDate}T${startTime}:00`, timeZone: tz },
            end:         { dateTime: `${eventDate}T${endTime}:00`,   timeZone: tz },
            attendees:   [{ email }],
        };

        // Wax-removal events get colorId 7 (cyan) — same as frontend
        if (eventType === 'wax-removal') {
            eventPayload.colorId = '7';
        }

        console.log(`[bookEvent] Booking "${selectedEvent.label}" on store "${calendarId}" for ${email} on ${eventDate} at ${startTime}`);

        // ── 9. Create the event via Google Calendar API ──────────────────────
        //    sendUpdates: 'all'  → Google sends invite emails to all attendees
        const calendar = google.calendar({ version: 'v3', auth: authClient });
        const created  = await calendar.events.insert({
            calendarId:  'primary',
            sendUpdates: 'all',
            requestBody: eventPayload,
        });

        console.log(`[bookEvent] ✅ Event created: ${created.data.id} | Link: ${created.data.htmlLink}`);

        // ── 10. Return success ───────────────────────────────────────────────
        return res.status(201).json({
            success:      true,
            eventId:      created.data.id,
            htmlLink:     created.data.htmlLink,
            inviteSentTo: email,
            event: {
                summary:   eventPayload.summary,
                date:      eventDate,
                startTime: startTime,
                endTime:   endTime,
                duration:  `${selectedEvent.duration} minutes`,
                store:     storeData.storeName || calendarId,
                timeZone:  tz,
            },
        });

    } catch (err) {
        console.error('[bookEvent] Error:', err.message);

        // Google API errors come back with err.errors array
        if (err.errors && err.errors.length) {
            return res.status(502).json({
                error:   'Google Calendar API error',
                details: err.errors[0].message,
            });
        }

        return res.status(500).json({ error: err.message || 'Failed to book event' });
    }
};
