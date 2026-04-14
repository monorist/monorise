export const MONORISE_CONFIG_TEMPLATE = `const config = {
  configDir: './monorise/configs',
  // custom routes should export default a Hono object.
  customRoutes: './services/core/routes.ts',
};

export default config;
`;
