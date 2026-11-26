import { defineApiKeyPolicies } from 'monorise/base';

// What each key in API_KEYS can reach. Keys under `default` can do everything
// until you define `default` here; then they get exactly what it grants, and
// the keys stay the same. https://monorise.dev/api-keys
export default defineApiKeyPolicies({
  // default: {
  //   entities: {
  //     [Entity.USER]: { read: '*', update: ['displayName'] },
  //   },
  // },
});
