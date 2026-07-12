import { verifyToken } from './token-utils.js';
import db from './database.js';

/**
 * Middleware to authenticate stateless Bearer tokens
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Access token is required.'
      }
    });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired access token.'
      }
    });
  }

  req.user = payload; // { user_id, name, email, role }
  next();
}

/**
 * Middleware to authorize access to specific modules based on database permissions
 * @param {string} moduleName - Name of the module (e.g., 'Fleet', 'Drivers', 'Trips', 'Fuel/Exp', 'Analytics', 'Settings')
 * @param {string} requiredAccessLevel - 'View' or 'Edit'
 */
export function authorizeModule(moduleName, requiredAccessLevel = 'View') {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User authentication required.'
        }
      });
    }

    const userRole = req.user.role;

    db.get(
      `SELECT rp.access_level 
       FROM role_permissions rp
       JOIN roles r ON rp.role_id = r.role_id
       WHERE r.name = ? AND rp.module = ?`,
      [userRole, moduleName],
      (err, row) => {
        if (err) {
          console.error(`Authorization database error: ${err.message}`);
          return res.status(500).json({
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'An error occurred during authorization check.'
            }
          });
        }

        const accessLevel = row ? row.access_level : 'None';

        if (accessLevel === 'None') {
          return res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: `Access denied. Role '${userRole}' has no permissions for module '${moduleName}'.`
            }
          });
        }

        if (requiredAccessLevel === 'Edit' && accessLevel !== 'Edit') {
          return res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: `Access denied. Role '${userRole}' does not have Edit permissions for module '${moduleName}'.`
            }
          });
        }

        next();
      }
    );
  };
}
