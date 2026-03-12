import { google } from 'googleapis';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Initialize Firebase Admin SDK
try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase Admin Initialized Successfully');
    } else {
        console.warn('⚠️ Firebase Service Account file not found at:', serviceAccountPath);
        console.warn('⚠️ Please download the JSON from Firebase Console and place it at the specified path.');
    }
} catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
}

export const db = admin.apps.length ? admin.firestore() : null;

// Initialize Google OAuth2 Client
export const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'postmessage' // Special value required when using the frontend code flow (initCodeClient)
);
