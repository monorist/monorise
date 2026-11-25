/**
 * Logs only when the MONORISE_DEBUG environment variable is set. These
 * traces print request data, such as mutual payloads, so they stay out of
 * logs by default.
 */
export const debugLog = (...args: unknown[]) => {
  const flag = process.env.MONORISE_DEBUG;
  if (flag && flag !== '0' && flag !== 'false') console.log(...args);
};
