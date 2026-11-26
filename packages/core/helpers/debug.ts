// Values that leave tracing off, compared case-insensitively.
const OFF = new Set(['', '0', 'false', 'off', 'no']);

/**
 * Logs only when the MONORISE_DEBUG environment variable is set. These
 * traces print request data, such as mutual payloads, so they stay out of
 * logs by default.
 */
export const debugLog = (...args: unknown[]) => {
  const flag = process.env.MONORISE_DEBUG?.trim().toLowerCase();
  if (flag !== undefined && !OFF.has(flag)) console.log(...args);
};
