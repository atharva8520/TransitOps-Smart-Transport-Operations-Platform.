import express from 'express';
import db from '../../shared/database.js';
import { authenticateToken, authorizeModule } from '../../shared/auth-middleware.js';

const router = express.Router();

// GET /api/v1/fuel-expenses/fuel-logs
router.get('/fuel-logs', authenticateToken, authorizeModule('Fuel/Exp', 'View'), (req, res) => {
  const sql = `
    SELECT fl.*, v.name as vehicle_name, v.registration_no as vehicle_registration, t.trip_code
    FROM fuel_logs fl
    JOIN vehicles v ON fl.vehicle_id = v.vehicle_id
    LEFT JOIN trips t ON fl.trip_id = t.trip_id
    ORDER BY fl.log_date DESC, fl.fuel_log_id DESC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching fuel logs:', err.message);
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Database query failed.' } });
    }
    res.status(200).json({ data: rows });
  });
});

// POST /api/v1/fuel-expenses/fuel-logs
router.post('/fuel-logs', authenticateToken, authorizeModule('Fuel/Exp', 'Edit'), (req, res) => {
  const { vehicle_id, trip_id, log_date, liters, fuel_cost } = req.body;

  if (!vehicle_id || !log_date || liters === undefined || fuel_cost === undefined) {
    return res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'vehicle_id, log_date, liters, and fuel_cost are required.' }
    });
  }

  const numLiters = parseFloat(liters);
  const numFuelCost = parseFloat(fuel_cost);

  if (isNaN(numLiters) || numLiters <= 0 || isNaN(numFuelCost) || numFuelCost <= 0) {
    return res.status(400).json({
      error: { code: 'INVALID_INPUT', message: 'Liters and fuel cost must be numeric and greater than zero.' }
    });
  }

  // Validate vehicle exists
  db.get('SELECT * FROM vehicles WHERE vehicle_id = ?', [vehicle_id], (err, vehicle) => {
    if (err) {
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
    if (!vehicle) {
      return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found.' } });
    }

    const tripIdVal = trip_id ? parseInt(trip_id, 10) : null;
    db.run(
      `INSERT INTO fuel_logs (vehicle_id, trip_id, log_date, liters, fuel_cost)
       VALUES (?, ?, ?, ?, ?)`,
      [vehicle_id, tripIdVal, log_date, numLiters, numFuelCost],
      function (err) {
        if (err) {
          console.error('Error creating fuel log:', err.message);
          return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Database insert failed.' } });
        }
        res.status(201).json({ data: { fuel_log_id: this.lastID, success: true } });
      }
    );
  });
});

// GET /api/v1/fuel-expenses/expenses
router.get('/expenses', authenticateToken, authorizeModule('Fuel/Exp', 'View'), (req, res) => {
  const sql = `
    SELECT e.*, v.name as vehicle_name, v.registration_no as vehicle_registration, t.trip_code,
           (e.toll_cost + e.other_cost + 
            CASE WHEN e.maintenance_linked = 1 THEN 
              (SELECT COALESCE(SUM(m.cost), 0) FROM maintenance_logs m WHERE m.vehicle_id = e.vehicle_id)
            ELSE 0 END) AS total_cost
    FROM expenses e
    JOIN vehicles v ON e.vehicle_id = v.vehicle_id
    LEFT JOIN trips t ON e.trip_id = t.trip_id
    ORDER BY e.expense_id DESC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching expenses:', err.message);
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Database query failed.' } });
    }
    res.status(200).json({ data: rows });
  });
});

// POST /api/v1/fuel-expenses/expenses
router.post('/expenses', authenticateToken, authorizeModule('Fuel/Exp', 'Edit'), (req, res) => {
  const { vehicle_id, trip_id, toll_cost, other_cost, maintenance_linked } = req.body;

  if (!vehicle_id) {
    return res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'vehicle_id is required.' }
    });
  }

  const numToll = toll_cost !== undefined ? parseFloat(toll_cost) : 0;
  const numOther = other_cost !== undefined ? parseFloat(other_cost) : 0;
  const isMaintLinked = maintenance_linked ? 1 : 0;

  if (isNaN(numToll) || numToll < 0 || isNaN(numOther) || numOther < 0) {
    return res.status(400).json({
      error: { code: 'INVALID_INPUT', message: 'Costs must be positive numbers.' }
    });
  }

  db.get('SELECT * FROM vehicles WHERE vehicle_id = ?', [vehicle_id], (err, vehicle) => {
    if (err) {
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }
    if (!vehicle) {
      return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found.' } });
    }

    const tripIdVal = trip_id ? parseInt(trip_id, 10) : null;
    db.run(
      `INSERT INTO expenses (vehicle_id, trip_id, toll_cost, other_cost, maintenance_linked)
       VALUES (?, ?, ?, ?, ?)`,
      [vehicle_id, tripIdVal, numToll, numOther, isMaintLinked],
      function (err) {
        if (err) {
          console.error('Error adding expense:', err.message);
          return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Database insert failed.' } });
        }
        
        // Return success and calculated cost
        const id = this.lastID;
        db.get(
          `SELECT e.*,
                  (e.toll_cost + e.other_cost + 
                   CASE WHEN e.maintenance_linked = 1 THEN 
                     (SELECT COALESCE(SUM(m.cost), 0) FROM maintenance_logs m WHERE m.vehicle_id = e.vehicle_id)
                   ELSE 0 END) AS total_cost
           FROM expenses e WHERE e.expense_id = ?`,
          [id],
          (err, row) => {
            if (err) {
              return res.status(200).json({ data: { expense_id: id, success: true } });
            }
            res.status(201).json({ data: row });
          }
        );
      }
    );
  });
});

// GET /api/v1/fuel-expenses/vehicle-costs
router.get('/vehicle-costs', authenticateToken, authorizeModule('Fuel/Exp', 'View'), (req, res) => {
  const sql = `
    SELECT v.vehicle_id, v.name, v.registration_no,
           COALESCE((SELECT SUM(fl.fuel_cost) FROM fuel_logs fl WHERE fl.vehicle_id = v.vehicle_id), 0) as total_fuel_cost,
           COALESCE((SELECT SUM(m.cost) FROM maintenance_logs m WHERE m.vehicle_id = v.vehicle_id), 0) as total_maintenance_cost,
           (COALESCE((SELECT SUM(fl.fuel_cost) FROM fuel_logs fl WHERE fl.vehicle_id = v.vehicle_id), 0) +
            COALESCE((SELECT SUM(m.cost) FROM maintenance_logs m WHERE m.vehicle_id = v.vehicle_id), 0)) as total_operational_cost
    FROM vehicles v
    ORDER BY total_operational_cost DESC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching vehicle operational costs:', err.message);
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Database query failed.' } });
    }
    res.status(200).json({ data: rows });
  });
});

export default router;
