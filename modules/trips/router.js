import express from 'express';
import db from '../../shared/database.js';
import { authenticateToken, authorizeModule } from '../../shared/auth-middleware.js';
import { validators, validationRules } from '../../shared/validation-middleware.js';
import { RulesEngine } from '../../rules-engine/index.js';

const router = express.Router();
const rulesEngine = new RulesEngine(db);

// Helper to parse Rules Engine error messages into API error shapes
function handleRulesEngineError(err, res) {
  console.error('Rules Engine Transition Error:', err.message);
  const match = err.message.match(/^([A-Z_]+):\s*(.*)$/);
  if (match) {
    const code = match[1];
    const message = match[2];
    
    let status = 400;
    if (['VEHICLE_NOT_FOUND', 'DRIVER_NOT_FOUND', 'TRIP_NOT_FOUND', 'MAINTENANCE_NOT_FOUND'].includes(code)) {
      status = 404;
    } else if (['TRIP_NOT_DRAFT', 'TRIP_NOT_DISPATCHED', 'TRIP_ALREADY_COMPLETED', 'TRIP_ALREADY_CANCELLED', 'ALREADY_CLOSED', 'MAINTENANCE_ALREADY_OPEN'].includes(code)) {
      status = 409;
    } else if (['CAPACITY_EXCEEDED', 'DRIVER_INELIGIBLE', 'VEHICLE_UNAVAILABLE', 'DRIVER_UNAVAILABLE', 'ODOMETER_INVALID'].includes(code)) {
      status = 422;
    }
    
    return res.status(status).json({
      error: { code, message }
    });
  }
  
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An internal server error occurred.'
    }
  });
}

// GET /api/v1/trips
router.get('/', authenticateToken, authorizeModule('Trips', 'View'), validators.filterById, (req, res) => {
  const { status, vehicle_id, driver_id } = req.query;
  let sql = `
    SELECT t.*, v.name as vehicle_name, v.registration_no as vehicle_registration, d.name as driver_name 
    FROM trips t
    JOIN vehicles v ON t.vehicle_id = v.vehicle_id
    JOIN drivers d ON t.driver_id = d.driver_id
  `;
  const params = [];
  const clauses = [];

  if (status) {
    clauses.push('t.status = ?');
    params.push(status);
  }
  if (vehicle_id) {
    clauses.push('t.vehicle_id = ?');
    params.push(vehicle_id);
  }
  if (driver_id) {
    clauses.push('t.driver_id = ?');
    params.push(driver_id);
  }

  if (clauses.length > 0) {
    sql += ' WHERE ' + clauses.join(' AND ');
  }

  sql += ' ORDER BY t.created_at DESC';

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching trips:', err.message);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An internal database error occurred.'
        }
      });
    }
    res.status(200).json({ data: rows });
  });
});

// POST /api/v1/trips (Draft only)
router.post('/', authenticateToken, authorizeModule('Trips', 'Edit'), ...validators.createTrip, (req, res) => {
  const { source, destination, vehicle_id, driver_id, cargo_weight_kg, planned_distance_km } = req.body;

  // 2. Fetch Vehicle and check details
  db.get('SELECT * FROM vehicles WHERE vehicle_id = ?', [vehicle_id], (err, vehicle) => {
    if (err) {
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
    if (!vehicle) {
      return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found.' } });
    }
    if (vehicle.status !== 'Available') {
      return res.status(422).json({ error: { code: 'VEHICLE_UNAVAILABLE', message: `Vehicle is currently ${vehicle.status}.` } });
    }

    // 3. Check Cargo Weight Limit
    if (cargo_weight_kg > vehicle.max_capacity_kg) {
      const exceeded = cargo_weight_kg - vehicle.max_capacity_kg;
      return res.status(422).json({
        error: {
          code: 'CAPACITY_EXCEEDED',
          message: `Capacity exceeded by ${exceeded} kg - dispatch blocked`
        }
      });
    }

    // 4. Fetch Driver and check details
    db.get('SELECT * FROM drivers WHERE driver_id = ?', [driver_id], (err, driver) => {
      if (err) {
        return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
      }
      if (!driver) {
        return res.status(404).json({ error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found.' } });
      }
      if (driver.status !== 'Available') {
        return res.status(422).json({ error: { code: 'DRIVER_UNAVAILABLE', message: `Driver is currently ${driver.status}.` } });
      }

      // 5. Check License Expiry
      const today = new Date().toISOString().split('T')[0];
      if (driver.license_expiry < today) {
        return res.status(422).json({
          error: {
            code: 'DRIVER_INELIGIBLE',
            message: 'Driver license has expired.'
          }
        });
      }

      // 6. Generate Trip Code and insert
      db.get('SELECT MAX(trip_id) as maxId FROM trips', (err, row) => {
        if (err) {
          return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
        }
        
        const nextId = (row && row.maxId ? row.maxId : 0) + 1;
        const tripCode = `TR${String(nextId).padStart(3, '0')}`;

        db.run(
          `INSERT INTO trips (trip_code, source, destination, vehicle_id, driver_id, cargo_weight_kg, planned_distance_km, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft')`,
          [tripCode, source, destination, vehicle_id, driver_id, cargo_weight_kg, planned_distance_km],
          function(err) {
            if (err) {
              console.error('Error creating trip:', err.message);
              return res.status(500).json({
                error: {
                  code: 'INTERNAL_SERVER_ERROR',
                  message: 'Could not create the trip in database.'
                }
              });
            }

            // Return created trip detail
            db.get('SELECT * FROM trips WHERE trip_id = ?', [this.lastID], (err, newTrip) => {
              res.status(201).json({ data: newTrip });
            });
          }
        );
      });
    });
  });
});

// POST /api/v1/trips/:id/dispatch
router.post('/:id/dispatch', authenticateToken, authorizeModule('Trips', 'Edit'), async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  try {
    const result = await rulesEngine.transition('dispatch', { tripId });
    res.status(200).json({ data: result });
  } catch (err) {
    handleRulesEngineError(err, res);
  }
});

// POST /api/v1/trips/:id/complete
router.post('/:id/complete', authenticateToken, authorizeModule('Trips', 'Edit'), ...validators.completeTrip, async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const { final_odometer_km, fuel_consumed_l, revenue_amount } = req.body;

  try {
    const revenueAmount = revenue_amount !== undefined && revenue_amount !== null && revenue_amount !== '' ? parseFloat(revenue_amount) : null;
    const result = await rulesEngine.transition(
      'complete', 
      { tripId }, 
      { 
        finalOdometer: parseFloat(final_odometer_km), 
        fuelConsumed: parseFloat(fuel_consumed_l),
        revenueAmount: revenueAmount
      }
    );
    res.status(200).json({ data: result });
  } catch (err) {
    handleRulesEngineError(err, res);
  }
});

// POST /api/v1/trips/:id/cancel
router.post('/:id/cancel', authenticateToken, authorizeModule('Trips', 'Edit'), async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  try {
    const result = await rulesEngine.transition('cancel', { tripId });
    res.status(200).json({ data: result });
  } catch (err) {
    handleRulesEngineError(err, res);
  }
});

export default router;
