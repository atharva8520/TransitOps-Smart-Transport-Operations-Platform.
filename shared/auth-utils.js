import crypto from 'crypto';

const KEY_LEN = 64;

/**
 * Hashes a password using crypto.scrypt.
 * @param {string} password 
 * @returns {Promise<string>} Resolves with format: "salt:hash"
 */
export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, KEY_LEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verifies a password against a stored "salt:hash" string.
 * @param {string} password 
 * @param {string} storedHash 
 * @returns {Promise<boolean>} Resolves to true if match, false otherwise
 */
export function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    if (!storedHash || !storedHash.includes(':')) {
      return resolve(false);
    }
    const [salt, originalHash] = storedHash.split(':');
    crypto.scrypt(password, salt, KEY_LEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey.toString('hex') === originalHash);
    });
  });
}
