import express from 'express';
import db from '../../shared/database.js';
import { authenticateToken, authorizeModule } from '../../shared/auth-middleware.js';
import { validators } from '../../shared/validation-middleware.js';

const router = express.Router();

router.get('/', authenticateToken, authorizeModule('Drivers', 'View'), validators.filterByStatus, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM drivers';
  const params = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching drivers:', err.message);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An internal server error occurred.'
        }
      });
    }

    // Mask contact number for non-Safety-Officer roles
    const userRole = req.user.role;
    const processedRows = rows.map((driver) => {
      const driverCopy = { ...driver };
      if (userRole !== 'Safety Officer' && driverCopy.contact_number) {
        const contact = driverCopy.contact_number;
        driverCopy.contact_number = contact.length >= 5 ? contact.substring(0, 5) + 'x****x' : '*****';
      }
      return driverCopy;
    });

    res.status(200).json({ data: processedRows });
  });
});

export default router;
