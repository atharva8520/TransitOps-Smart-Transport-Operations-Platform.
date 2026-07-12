import express from 'express';
import db from '../../shared/database.js';
import { verifyPassword } from '../../shared/auth-utils.js';
import { generateToken } from '../../shared/token-utils.js';
import { validators } from '../../shared/validation-middleware.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const LOCKOUT_COOLDOWN_MINUTES = parseInt(process.env.LOCKOUT_COOLDOWN_MINUTES || '15', 10);
const SESSION_EXPIRY_HOURS = parseInt(process.env.SESSION_EXPIRY_HOURS || '24', 10);

router.post('/login', ...validators.login, (req, res) => {
  const { email, password, role } = req.body;

  // Helper to handle bad credentials response and increment failed count
  const failLogin = (userId, currentFailedCount) => {
    if (userId) {
      const newCount = currentFailedCount + 1;
      let lockedUntil = null;
      if (newCount >= 5) {
        lockedUntil = new Date(Date.now() + LOCKOUT_COOLDOWN_MINUTES * 60 * 1000).toISOString();
      }

      db.run(
        'UPDATE users SET failed_login_count = ?, locked_until = ? WHERE user_id = ?',
        [newCount, lockedUntil, userId],
        (err) => {
          if (err) {
            console.error('Failed to update login attempts:', err.message);
          }
          
          if (newCount >= 5) {
            return res.status(423).json({
              error: {
                code: 'ACCOUNT_LOCKED',
                message: 'Invalid credentials. Account locked after 5 failed attempts.'
              }
            });
          } else {
            return res.status(401).json({
              error: {
                code: 'INVALID_CREDENTIALS',
                message: 'Invalid credentials.'
              }
            });
          }
        }
      );
    } else {
      // User doesn't exist, return standard unauthorized
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials.'
        }
      });
    }
  };

  // 2. Query user joining role
  db.get(
    `SELECT u.*, r.name as role_name 
     FROM users u 
     JOIN roles r ON u.role_id = r.role_id 
     WHERE u.email = ?`,
    [email],
    async (err, user) => {
      if (err) {
        console.error('Database error during login:', err.message);
        return res.status(500).json({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An internal server error occurred.'
          }
        });
      }

      // If user not found, trigger generic fail (no user ID)
      if (!user) {
        return failLogin(null, 0);
      }

      // 3. Check Lockout State
      if (user.locked_until) {
        const lockedTime = new Date(user.locked_until).getTime();
        if (Date.now() < lockedTime) {
          return res.status(423).json({
            error: {
              code: 'ACCOUNT_LOCKED',
              message: 'Invalid credentials. Account locked after 5 failed attempts.'
            }
          });
        } else {
          // Cooldown expired, reset lockout fields locally before continuing
          db.run(
            'UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE user_id = ?',
            [user.user_id]
          );
          user.failed_login_count = 0;
          user.locked_until = null;
        }
      }

      // 4. Verify password
      try {
        const isPasswordCorrect = await verifyPassword(password, user.password_hash);
        if (!isPasswordCorrect) {
          return failLogin(user.user_id, user.failed_login_count);
        }

        // 5. Verify role matches
        if (user.role_name !== role) {
          // Increment failure to prevent role scanning/probing
          return failLogin(user.user_id, user.failed_login_count);
        }

        // Success: Reset failed count & lockout timer
        db.run(
          'UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE user_id = ?',
          [user.user_id],
          (err) => {
            if (err) console.error('Failed to reset login attempts:', err.message);
          }
        );

        // Generate token
        const tokenPayload = {
          user_id: user.user_id,
          name: user.name,
          email: user.email,
          role: user.role_name
        };
        const token = generateToken(tokenPayload, SESSION_EXPIRY_HOURS);

        return res.status(200).json({
          token,
          user: tokenPayload
        });

      } catch (cryptoErr) {
        console.error('Crypto error during login:', cryptoErr);
        return res.status(500).json({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An authentication error occurred.'
          }
        });
      }
    }
  );
});

router.post('/logout', (req, res) => {
  res.status(200).json({ success: true });
});

export default router;
