const config = {
  configDir: './monorise/configs',
  // custom routes should export default a Hono object.
  customRoutes: './services/core/routes.ts',
  // API key policies: what each key in API_KEYS can reach.
  apiKeys: './monorise/api-keys',
};

export default config;
