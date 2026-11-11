import { AsyncLocalStorage } from 'node:async_hooks';

/** The API key behind a request, as events and logs record it. */
export type RequestApiKey = {
  policy: string;
  /** SHA-256 digest of the key: identifies it without revealing it. */
  fingerprint: string;
};

const storage = new AsyncLocalStorage<RequestApiKey>();

/** Runs `fn`, and everything it awaits, as a request made with `apiKey`. */
export const runWithApiKey = <T>(apiKey: RequestApiKey, fn: () => T): T =>
  storage.run(apiKey, fn);

/**
 * The API key of the request the calling code runs for. `undefined` outside
 * an API request, e.g. in processors, whose work is the system's own.
 */
export const currentApiKey = (): RequestApiKey | undefined =>
  storage.getStore();
