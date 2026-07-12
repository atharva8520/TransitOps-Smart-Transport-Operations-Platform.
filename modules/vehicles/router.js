import express from 'express';
import db from '../../shared/database.js';
import { authenticateToken, authorizeModule } from '../../shared/auth-middleware.js';
import { validators, validationRules } from '../../shared/validation-middleware.js';

const router = express.Router();

router.get('/', authenticateToken, authorizeModule('Fleet', 'View'), validators.filterByStatus, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM vehicles';
  const params = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching vehicles:', err.message);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An internal server error occurred.'
        }
      });
    }
    res.status(200).json({ data: rows });
  });
});

export default router;
