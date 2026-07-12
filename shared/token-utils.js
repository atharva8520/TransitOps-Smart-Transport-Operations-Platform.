import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const SECRET = process.env.TOKEN_SECRET || 'fallback_default_secret_for_transitops_32_chars';
// Ensure secret is exactly 32 bytes by hashing it
const key = crypto.createHash('sha256').update(SECRET).digest();

/**
 * Encrypts a payload into a stateless bearer token
 * @param {object} payload 
 * @param {number} expiryHours 
 * @returns {string} iv:encryptedText:authTag
 */
export function generateToken(payload, expiryHours = 24) {
  const expiresAt = Date.now() + expiryHours * 60 * 60 * 1000;
  const data = JSON.stringify({ ...payload, expiresAt });
  
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

/**
 * Decrypts and validates a stateless bearer token
 * @param {string} token 
 * @returns {object|null} payload or null if invalid/expired
 */
export function verifyToken(token) {
  try {
    if (!token || !token.includes(':')) return null;
    const [ivHex, encrypted, authTagHex] = token.split(':');
    if (!ivHex || !encrypted || !authTagHex) return null;
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    const payload = JSON.parse(decrypted);
    if (payload.expiresAt && Date.now() > payload.expiresAt) {
      return null; // Token has expired
    }
    return payload;
  } catch (err) {
    return null; // Invalid token
  }
}
