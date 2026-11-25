---
"@monorise/core": major
"@monorise/react": major
"monorise": major
---

Retire `account-id`: Monorise no longer does anything with user identity or auth.

**Breaking, `@monorise/core`:**
- Built-in routes no longer read the `account-id` header.
- `entityService`, `mutualService` and `transactionService` methods no longer take `accountId`, and `afterCreateEntityHook` no longer receives it.
- Events no longer carry `createdByAccountId`, `updatedByAccountId` or `deletedByAccountId`. To know who made a change, record the user in your own app; Core's events already carry the API key (`apiKey.policy` and `apiKey.fingerprint`).

**Breaking, `@monorise/react`:**
- The auth module is gone: `requestLogin`, `useProfile`, `getProfile`, `useIsUnauthorized`, `setIsUnauthorized`, `logout`, `authService`, the `authBaseUrl` option, and the store's `auth` state.
- The axios instance no longer flags 401s as unauthorized; a 401 is in the error store like any other error.
- Use your own auth library for sign-in, sessions and profiles.
