import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Import db to trigger connection
import db from './shared/database.js';

// Import routers
import authRouter from './modules/auth/router.js';
import vehiclesRouter from './modules/vehicles/router.js';
import driversRouter from './modules/drivers/router.js';
import tripsRouter from './modules/trips/router.js';
import maintenanceRouter from './modules/maintenance/router.js';
import fuelExpensesRouter from './modules/fuel-expenses/router.js';
import reportsRouter from './modules/reports/router.js';
import settingsRouter from './modules/settings/router.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes (base path: /api/v1)
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/vehicles', vehiclesRouter);
app.use('/api/v1/drivers', driversRouter);
app.use('/api/v1/trips', tripsRouter);
app.use('/api/v1/maintenance', maintenanceRouter);
app.use('/api/v1/fuel-expenses', fuelExpensesRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/settings', settingsRouter);

// Fallback SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`TransitOps server is running on http://localhost:${PORT}`);
});
