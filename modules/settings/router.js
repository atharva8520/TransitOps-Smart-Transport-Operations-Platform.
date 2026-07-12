import express from 'express';
import db from '../../shared/database.js';
import { authenticateToken } from '../../shared/auth-middleware.js';
import { validators, validationRules, handleValidationErrors } from '../../shared/validation-middleware.js';

const router = express.Router();

// Middleware to restrict to Fleet Manager role only
function requireFleetManager(req, res, next) {
  if (!req.user || req.user.role !== 'Fleet Manager') {
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied. Fleet Manager privileges required.'
      }
    });
  }
  next();
}

// GET /api/v1/settings
router.get('/', authenticateToken, requireFleetManager, (req, res) => {
  db.get('SELECT * FROM settings LIMIT 1', [], (err, row) => {
    if (err) {
      console.error('Error fetching settings:', err.message);
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch settings.' } });
    }
    // Return row or default if database settings table is empty
    const settings = row || { depot_name: 'Gandhinagar Central Depot', currency: 'INR', distance_unit: 'Kilometers' };
    res.status(200).json({ data: settings });
  });
});

// PUT /api/v1/settings
router.put('/', authenticateToken, requireFleetManager, ...validators.updateSettings, (req, res) => {
  const { depot_name, currency, distance_unit } = req.body;

  db.get('SELECT setting_id FROM settings LIMIT 1', [], (err, row) => {
    if (err) {
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: err.message } });
    }

    if (row) {
      db.run(
        'UPDATE settings SET depot_name = ?, currency = ?, distance_unit = ? WHERE setting_id = ?',
        [depot_name, currency, distance_unit, row.setting_id],
        function (err) {
          if (err) {
            console.error('Error updating settings:', err.message);
            return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Update failed.' } });
          }
          res.status(200).json({ data: { depot_name, currency, distance_unit, setting_id: row.setting_id } });
        }
      );
    } else {
      db.run(
        'INSERT INTO settings (depot_name, currency, distance_unit) VALUES (?, ?, ?)',
        [depot_name, currency, distance_unit],
        function (err) {
          if (err) {
            console.error('Error creating settings:', err.message);
            return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Insert failed.' } });
          }
          res.status(201).json({ data: { depot_name, currency, distance_unit, setting_id: this.lastID } });
        }
      );
    }
  });
});

// GET /api/v1/settings/rbac
router.get('/rbac', authenticateToken, requireFleetManager, (req, res) => {
  const sql = `
    SELECT rp.*, r.name as role_name
    FROM role_permissions rp
    JOIN roles r ON rp.role_id = r.role_id
    ORDER BY r.name, rp.module
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching RBAC permissions:', err.message);
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to query permissions.' } });
    }
    res.status(200).json({ data: rows });
  });
});

// PUT /api/v1/settings/rbac
router.put('/rbac', authenticateToken, requireFleetManager, (req, res) => {
  const { permissions } = req.body; // Expects an array of: { role_id, module, access_level }

  if (!permissions || !Array.isArray(permissions)) {
    return res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'permissions field must be an array.' }
    });
  }

  // Verify elements have correct structure
  for (const p of permissions) {
    if (p.role_id === undefined || !p.module || !p.access_level) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Each permission must contain role_id, module, and access_level.' }
      });
    }
    if (!['None', 'View', 'Edit'].includes(p.access_level)) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: `Invalid access_level '${p.access_level}'. Must be None, View, or Edit.` }
      });
    }
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    const stmt = db.prepare('UPDATE role_permissions SET access_level = ? WHERE role_id = ? AND module = ?');
    
    let dbErr = null;
    permissions.forEach(p => {
      stmt.run(p.access_level, p.role_id, p.module, (err) => {
        if (err) dbErr = err;
      });
    });

    stmt.finalize((err) => {
      if (err || dbErr) {
        db.run('ROLLBACK');
        console.error('RBAC bulk update finalize failed:', err || dbErr);
        return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Transaction preparation failed.' } });
      }

      db.run('COMMIT', (commitErr) => {
        if (commitErr) {
          console.error('RBAC commit failed:', commitErr.message);
          return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Transaction commit failed.' } });
        }
        res.status(200).json({ data: { success: true, message: 'RBAC permissions updated successfully.' } });
      });
    });
  });
});

export default router;
