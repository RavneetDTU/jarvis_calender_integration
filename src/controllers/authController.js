import { oauth2Client, db } from '../config/auth.js';
import { google } from 'googleapis';

export const googleAuthCallback = async (req, res) => {
    try {
        const { code, calendarId, storeName, userId } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Authorization code is required' });
        }
        if (!calendarId || !storeName || !userId) {
            return res.status(400).json({ error: 'calendarId, storeName, and userId are required' });
        }

        // 1. Exchange the auth code for access and refresh tokens
        const { tokens } = await oauth2Client.getToken(code);
        
        // 2. We specifically need the refresh token to save it. 
        // If Google didn't send one, it means the user has granted access previously.
        if (tokens.refresh_token) {
            console.log(`Received new refresh token for store: ${calendarId} user: ${userId}`);
            if (db) {
                // Save the refresh token to Firebase Firestore under a flat 'stores' collection
                await db.collection('stores').doc(calendarId).set({
                    userId: userId,
                    refresh_token: tokens.refresh_token,
                    storeName: storeName,
                    updatedAt: new Date()
                }, { merge: true });
                console.log(`[Success] Saved refresh token to Firebase for ${storeName} under user ID ${userId}`);
            } else {
                console.warn('⚠️ Firebase DB not initialized. Token was not saved to DB!');
            }
        } else {
            console.log(`No refresh token received for ${calendarId}. Google only sends it on the very first consent.`);
            // In a real app, if you don't have it in your DB, you must force the user to re-prompt consent using prompt: 'consent' on the frontend
        }

        // 3. Get User Email (We requested userinfo.profile scope)
        let email = null;
        try {
            const oauth2ClientWithToken = new google.auth.OAuth2();
            oauth2ClientWithToken.setCredentials(tokens);
            const oauth2 = google.oauth2({
                auth: oauth2ClientWithToken,
                version: 'v2'
            });
            const userInfo = await oauth2.userinfo.v2.me.get();
            email = userInfo.data.email;
            console.log(`[Success] Retrieved email ${email} for store ${storeName}`);
        } catch (emailErr) {
            console.warn('⚠️ Could not fetch user email from Google:', emailErr.message);
        }

        // 4. Send ONLY the access_token back to the frontend (frontend doesn't need the refresh token)
        res.json({
            success: true,
            access_token: tokens.access_token,
            expiry_date: tokens.expiry_date, // ms since epoch
            email: email
        });

    } catch (error) {
        console.error('Error exchanging google code:', error);
        res.status(500).json({ error: 'Failed to authenticate with Google' });
    }
};

export const refreshToken = async (req, res) => {
    try {
        const { calendarId, userId } = req.body;

        if (!calendarId || !userId) {
            return res.status(400).json({ error: 'calendarId (Store Name) and userId are required' });
        }

        if (!db) {
            return res.status(500).json({ error: 'Database not initialized, cannot retrieve refresh token' });
        }

        // 1. Get the store's refresh token from Firebase
        const storeDoc = await db.collection('stores').doc(calendarId).get();
        if (!storeDoc.exists || !storeDoc.data().refresh_token) {
            return res.status(404).json({ error: 'No refresh token found for this store. Please reconnect Google Calendar.' });
        }

        const refreshToken = storeDoc.data().refresh_token;

        // 2. Setup the OAuth client with the refresh token
        oauth2Client.setCredentials({
            refresh_token: refreshToken
        });

        // 3. Ask Google for a new Access Token
        const { credentials } = await oauth2Client.refreshAccessToken();

        // 4. Send the new access token to the frontend
        res.json({
            success: true,
            access_token: credentials.access_token,
            expiry_date: credentials.expiry_date
        });

    } catch (error) {
        console.error('Error refreshing token:', error);
        // If Google rejects the refresh token (e.g., user revoked access), return a 401
        res.status(401).json({ error: 'Failed to refresh token. Please reconnect Google Calendar.' });
    }
};

export const getUserCalendars = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        if (!db) {
            return res.status(500).json({ error: 'Database not initialized' });
        }

        const storesSnapshot = await db.collection('stores').where('userId', '==', userId).get();
        
        const stores = [];
        storesSnapshot.forEach(doc => {
            const data = doc.data();
            stores.push({
                calendarId: doc.id,
                storeName: data.storeName,
                updatedAt: data.updatedAt
            });
        });

        res.json({ success: true, stores });
    } catch (error) {
        console.error('Error fetching user calendars:', error);
        res.status(500).json({ error: 'Failed to fetch user calendars' });
    }
};

export const getCalendarEvents = async (req, res) => {
    try {
        const { calendarId } = req.params;
        const { date } = req.query; // Expecting YYYY-MM-DD or full ISO

        if (!calendarId) {
            return res.status(400).json({ error: 'calendarId is required' });
        }

        if (!db) {
            return res.status(500).json({ error: 'Database not initialized' });
        }

        // 1. Fetch token from flat stores collection
        const storeDoc = await db.collection('stores').doc(calendarId).get();
        if (!storeDoc.exists || !storeDoc.data().refresh_token) {
            return res.status(404).json({ error: 'Calendar connection not found or no refresh token' });
        }

        const refreshToken = storeDoc.data().refresh_token;

        // 2. Set temporary credentials for this request
        const oauth2ClientWithToken = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            'postmessage'
        );
        oauth2ClientWithToken.setCredentials({ refresh_token: refreshToken });

        // 3. Setup dates
        const targetDate = date ? new Date(date) : new Date();
        const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
        const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);

        // 4. Fetch events
        const calendar = google.calendar({ version: 'v3', auth: oauth2ClientWithToken });
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: startOfDay.toISOString(),
            timeMax: endOfDay.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        res.json({ success: true, events: response.data.items });
    } catch (error) {
        console.error('Error fetching calendar events:', error);
        res.status(500).json({ error: 'Failed to fetch calendar events from Google' });
    }
};
