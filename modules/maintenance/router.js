import express from 'express';
import db from '../../shared/database.js';
import { authenticateToken, authorizeModule } from '../../shared/auth-middleware.js';
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

// GET /api/v1/maintenance
router.get('/', authenticateToken, authorizeModule('Fleet', 'View'), (req, res) => {
  const { vehicle_id, record_status } = req.query;
  let sql = `
    SELECT m.*, v.name as vehicle_name, v.registration_no as vehicle_registration 
    FROM maintenance_logs m
    JOIN vehicles v ON m.vehicle_id = v.vehicle_id
  `;
  const params = [];
  const clauses = [];

  if (vehicle_id) {
    clauses.push('m.vehicle_id = ?');
    params.push(vehicle_id);
  }
  if (record_status) {
    clauses.push('m.record_status = ?');
    params.push(record_status);
  }

  if (clauses.length > 0) {
    sql += ' WHERE ' + clauses.join(' AND ');
  }

  sql += ' ORDER BY m.created_at DESC';

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching maintenance logs:', err.message);
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

// POST /api/v1/maintenance (Open record)
router.post('/', authenticateToken, authorizeModule('Fleet', 'Edit'), async (req, res) => {
  const { vehicle_id, service_type, cost, service_date } = req.body;

  if (!vehicle_id || !service_type || cost === undefined || !service_date) {
    return res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'All fields (vehicle_id, service_type, cost, service_date) are required.'
      }
    });
  }

  try {
    const result = await rulesEngine.transition(
      'maintenance_open', 
      { vehicleId: parseInt(vehicle_id, 10) }, 
      { serviceType: service_type, cost: parseFloat(cost), serviceDate: service_date }
    );
    res.status(201).json({ data: result });
  } catch (err) {
    handleRulesEngineError(err, res);
  }
});

// POST /api/v1/maintenance/:id/close
router.post('/:id/close', authenticateToken, authorizeModule('Fleet', 'Edit'), async (req, res) => {
  const maintenanceId = parseInt(req.params.id, 10);
  try {
    const result = await rulesEngine.transition('maintenance_close', { maintenanceId });
    res.status(200).json({ data: result });
  } catch (err) {
    handleRulesEngineError(err, res);
  }
});

export default router;
