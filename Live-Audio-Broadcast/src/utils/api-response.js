/**
 * Standard API response wrapper.
 */
export class ApiResponse {
  /**
   * @param {number} statusCode
   * @param {string} message
   * @param {object} [data]
   * @param {object} [meta]
   */
  constructor(statusCode, message, data, meta) {
    this.statusCode = statusCode;
    this.message = message;
    this.data = data ?? null;
    if (meta) this.meta = meta;
  }
}