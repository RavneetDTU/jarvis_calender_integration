import { oauth2Client, db } from '../config/auth.js';
import { google } from 'googleapis';

export const googleAuthCallback = async (req, res) => {
    try {
        const { code, calendarId, storeName } = req.body;
        console.log("request body data is :",req.body);

        if (!code) {
            return res.status(400).json({ error: 'Authorization code is required' });
        }
        if (!calendarId || !storeName) {
            return res.status(400).json({ error: 'calendarId and storeName are required' });
        }

        // 1. Exchange the auth code for access and refresh tokens
        const { tokens } = await oauth2Client.getToken(code);
        
        // 2. We specifically need the refresh token to save it. 
        // If Google didn't send one, it means the user has granted access previously.
        if (tokens.refresh_token) {
            console.log(`Received new refresh token for store: ${calendarId}`);
            if (db) {
                // Save the refresh token to Firebase Firestore under a 'stores' collection
                await db.collection('stores').doc(calendarId).set({
                    refresh_token: tokens.refresh_token,
                    storeName: storeName,
                    updatedAt: new Date()
                }, { merge: true });
                console.log(`[Success] Saved refresh token to Firebase for ${storeName} under ID ${calendarId}`);
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
        const { calendarId } = req.body;

        if (!calendarId) {
            return res.status(400).json({ error: 'calendarId (Store Name) is required' });
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
