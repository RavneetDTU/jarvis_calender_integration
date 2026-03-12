import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './src/routes/authRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Update origins to match your frontend URL
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:3000','https://www.jarviscalling.ai'],
    credentials: true
}));

app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

// Basic health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Mets Leads Backend is running' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
