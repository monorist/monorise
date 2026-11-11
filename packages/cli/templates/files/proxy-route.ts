import config from '#/monorise';
import { allow, createProxyHandler } from 'monorise/proxy';

// Forwards every request to Monorise Core with one key, and the key alone
// decides. Fine for local development. Before real users sign in, add
// authenticate, a key per kind of caller, and rules:
// https://monorise.dev/proxy
export const { GET, POST, PUT, PATCH, DELETE } = createProxyHandler({
  config,
  apiKey: process.env.MONORISE_API_KEY,
  rules: { '*': allow },
});
