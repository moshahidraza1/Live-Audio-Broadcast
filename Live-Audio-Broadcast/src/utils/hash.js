/**
 * Password hashing helpers.
 */
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

/**
 * @param {string} password
 * @returns {Promise<string>}
 */
export function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
