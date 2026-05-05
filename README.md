# Jarvis Calling — Calendar Integration Backend

A production-ready Node.js backend that connects Google Calendar with the Mets Leads CRM to enable seamless appointment booking for hearing clinics. The system handles Google OAuth 2.0 authentication, secure refresh token storage in Firebase Firestore, calendar event creation with patient invite emails, and per-store availability settings — all exposed via a clean REST API.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [API Reference](#api-reference)
- [Code Reference](#code-reference)
- [Firestore Collections](#firestore-collections)

---

## Architecture Overview

```
Frontend (Mets Leads CRM)
        │
        ▼
POST /api/auth/google          ← Exchanges Google OAuth code for tokens; stores refresh token in Firebase
        │
        ▼
Firebase Firestore (stores)    ← Keyed by calendarId (store ID); holds refresh_token, storeName, openTime, closeTime
        │
        ▼
POST /api/auth/refresh         ← Uses stored refresh token to issue a new access token on 401
        │
GET  /api/auth/calendars/:userId     ← Lists all connected stores for a user
GET  /api/auth/events/:calendarId    ← Fetches Google Calendar events for a given store and date
PATCH /api/auth/calendars/:calendarId/settings  ← Saves openTime / closeTime for a store
DELETE /api/auth/calendars/:calendarId          ← Disconnects and removes a store calendar
        │
        ▼
POST /api/auth/calendar/book-event   ← Books a Google Calendar event; emails invite to patient
        │
   Google Calendar API (v3)    ← Creates event with attendee invite (sendUpdates: 'all')
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM) |
| Framework | Express 5 |
| Authentication | Google OAuth 2.0 (`googleapis`) |
| Calendar API | Google Calendar v3 (`googleapis`) |
| Database | Firebase Firestore (via `firebase-admin`) |
| Environment | `dotenv` |
| CORS | `cors` |

---

## Project Structure

```
.
├── index.js                        # Main entry point — Express server, CORS, route registration
├── firebase-service-account.json   # Firebase Admin SDK credentials (not committed)
├── package.json
├── .env
└── src/
    ├── config/
    │   └── auth.js                 # Firebase Admin SDK init + Google OAuth2 client singleton
    ├── controllers/
    │   ├── authController.js       # Google OAuth flow, token refresh, calendar CRUD
    │   └── calendarController.js   # Google Calendar event booking logic
    └── routes/
        ├── authRoutes.js           # /api/auth/* route definitions
        └── calendarRoutes.js       # /api/auth/calendar/* route definitions
```

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Server
PORT=6000

# Google OAuth 2.0
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Firebase Admin SDK — path to the service account JSON file
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
```

> Firebase credentials are loaded from the JSON file at `FIREBASE_SERVICE_ACCOUNT_PATH`. Download this file from the Firebase Console under **Project Settings → Service Accounts → Generate new private key**.

---

## Getting Started

```bash
# Install dependencies
npm install

# Start server
npm start
```

The server starts on the port defined in `PORT` (default: `6000`).

**CORS** is pre-configured to allow requests from:
- `http://localhost:5173`
- `http://localhost:3000`
- `https://www.jarviscalling.ai`

**Health Check:**

```
GET /health
→ { "status": "OK", "message": "Mets Leads calendar integration Backend is running" }
```

---

## API Reference

### Authentication & Calendar Management

Base path: `/api/auth`

| Method | Path | Body / Params | Description |
|---|---|---|---|
| `POST` | `/api/auth/google` | `{ code, calendarId, storeName, userId }` | Exchanges Google OAuth authorization code for tokens; saves refresh token to Firestore |
| `POST` | `/api/auth/refresh` | `{ calendarId, userId }` | Retrieves stored refresh token from Firestore and issues a new Google access token |
| `GET` | `/api/auth/calendars/:userId` | `:userId` — Firebase user ID | Lists all stores connected to a user with their availability settings |
| `GET` | `/api/auth/events/:calendarId` | `:calendarId`, optional `?date=YYYY-MM-DD` | Fetches all Google Calendar events for a store on a given date (defaults to today) |
| `PATCH` | `/api/auth/calendars/:calendarId/settings` | `{ openTime, closeTime }` — HH:MM format | Saves business hours (open/close time) for a store calendar |
| `DELETE` | `/api/auth/calendars/:calendarId` | `:calendarId` | Disconnects and deletes a store's calendar connection from Firestore |

### Calendar Booking

Base path: `/api/auth/calendar`

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/auth/calendar/book-event` | See [Book Event Body](#book-event-request-body) | Books a Google Calendar appointment and emails a calendar invite to the patient |

#### Book Event Request Body

```json
{
  "calendarId":     "TOKAI",
  "eventType":      "hearing-aid-test",
  "eventDate":      "2026-05-10",
  "startTime":      "10:30",
  "timeZone":       "Africa/Johannesburg",
  "additionalNote": "Patient referred by GP.",
  "lead": {
    "name":  "John Smith",
    "phone": "0821234567",
    "email": "john@example.com"
  }
}
```

| Field | Required | Description |
|---|---|---|
| `calendarId` | ✅ | Store ID — must match a connected store in Firestore (e.g. `"TOKAI"`) |
| `eventType` | ✅ | `"hearing-aid-test"` (45 min) or `"wax-removal"` (30 min) |
| `eventDate` | ✅ | Date in `YYYY-MM-DD` format |
| `startTime` | ✅ | Start time in `HH:MM` 24-hour format |
| `lead.email` | ✅ | Patient email — Google Calendar sends the invite here |
| `lead.name` | ❌ | Patient full name |
| `lead.phone` | ❌ | Patient phone number |
| `timeZone` | ❌ | IANA timezone string (default: `Africa/Johannesburg`) |
| `additionalNote` | ❌ | Extra text appended to the event description |

**Success Response `201`:**

```json
{
  "success": true,
  "eventId": "abc123xyz",
  "htmlLink": "https://calendar.google.com/event?eid=...",
  "inviteSentTo": "john@example.com",
  "event": {
    "summary": "Hearing Aid Test — John Smith",
    "date": "2026-05-10",
    "startTime": "10:30",
    "endTime": "11:15",
    "duration": "45 minutes",
    "store": "Tokai",
    "timeZone": "Africa/Johannesburg"
  }
}
```

---

## Code Reference

### `index.js`

Entry point. Bootstraps Express, configures CORS, registers route groups, and starts the HTTP server.

| Handler | Description |
|---|---|
| `GET /health` | Health check endpoint — returns server status |
| `app.use('/api/auth', authRoutes)` | Mounts authentication and calendar management routes |
| `app.use('/api/auth/calendar', calendarRoutes)` | Mounts calendar booking route |

---

### `src/config/auth.js`

Initializes both Firebase Admin SDK and the Google OAuth2 client on import. Exports singletons used across all controllers.

| Export | Type | Purpose |
|---|---|---|
| `db` | Firestore instance | Active Firestore DB used across all controllers; `null` if Firebase failed to init |
| `oauth2Client` | `google.auth.OAuth2` | Shared OAuth2 client configured with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and redirect `'postmessage'` (required for the frontend authorization code flow) |

> Firebase initializes from the file path in `FIREBASE_SERVICE_ACCOUNT_PATH`. If the file is not found, a warning is logged and `db` is set to `null`.

---

### `src/controllers/authController.js`

Handles the complete Google OAuth lifecycle and per-store calendar management in Firestore.

| Function | Input | Output | Purpose |
|---|---|---|---|
| `googleAuthCallback` | `{ code, calendarId, storeName, userId }` | `{ success, access_token, expiry_date, email }` | Exchanges Google auth code for tokens; saves refresh token to Firestore; returns access token + email to frontend |
| `refreshToken` | `{ calendarId, userId }` | `{ success, access_token, expiry_date }` | Loads stored refresh token from Firestore and uses it to issue a fresh Google access token |
| `getUserCalendars` | `:userId` (URL param) | `{ success, stores[] }` | Queries Firestore for all store documents belonging to a user; returns list with `calendarId`, `storeName`, `openTime`, `closeTime` |
| `getCalendarEvents` | `:calendarId` (param), `?date=YYYY-MM-DD` (query) | `{ success, events[] }` | Fetches Google Calendar events for a store's primary calendar on the given date; auto-refreshes token |
| `updateCalendarSettings` | `:calendarId` (param), `{ openTime, closeTime }` | `{ success, calendarId, openTime, closeTime }` | Validates HH:MM format and saves `openTime` / `closeTime` to Firestore; uses `merge: true` to preserve other fields |
| `deleteCalendar` | `:calendarId` (param) | `{ success, message, calendarId }` | Confirms store exists then deletes the Firestore document, effectively disconnecting the Google Calendar |

---

### `src/controllers/calendarController.js`

Books Google Calendar appointments via the Calendar API and sends email invites to patients.

| Function | Input | Output | Purpose |
|---|---|---|---|
| `bookEvent` | Full request body (see [Book Event Request Body](#book-event-request-body)) | `{ success, eventId, htmlLink, inviteSentTo, event{} }` | Validates all inputs, loads the store's refresh token from Firestore, computes end time from event duration, builds event payload, creates the event via Google Calendar API with `sendUpdates: 'all'` |
| `buildWaxRemovalMessage` *(internal)* | `(eventDate, startTime)` | Formatted string | Generates the wax-removal appointment confirmation message included in the event description |

**Supported Event Types:**

| `eventType` value | Label | Duration |
|---|---|---|
| `hearing-aid-test` | Hearing Aid Test | 45 minutes |
| `wax-removal` | Wax Removal Test | 30 minutes |

> Wax-removal events are given calendar color **cyan** (`colorId: '7'`) to match the frontend display. The googleapis library automatically refreshes the access token using the stored `refresh_token` — no manual token management required.

---

### `src/routes/authRoutes.js`

Thin Express router. Delegates all logic to `authController.js`.

| Method | Path | Controller Function |
|---|---|---|
| `POST` | `/google` | `googleAuthCallback` |
| `POST` | `/refresh` | `refreshToken` |
| `GET` | `/calendars/:userId` | `getUserCalendars` |
| `GET` | `/events/:calendarId` | `getCalendarEvents` |
| `PATCH` | `/calendars/:calendarId/settings` | `updateCalendarSettings` |
| `DELETE` | `/calendars/:calendarId` | `deleteCalendar` |

---

### `src/routes/calendarRoutes.js`

Thin Express router. Delegates all logic to `calendarController.js`.

| Method | Path | Controller Function |
|---|---|---|
| `POST` | `/book-event` | `bookEvent` |

---

## Firestore Collections

| Collection | Document Key | Fields | Description |
|---|---|---|---|
| `stores` | `calendarId` (e.g. `"TOKAI"`) | `userId`, `storeName`, `refresh_token`, `openTime`, `closeTime`, `updatedAt` | One document per connected store; holds the OAuth refresh token and availability settings |
