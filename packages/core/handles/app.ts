import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { setupCommonRoutes } from '../controllers/setupRoutes';
import { apiKeyAuth } from '../middlewares/api-key-auth';
import { customRouteGate } from '../middlewares/authorize';
import generalErrorHandler from '../middlewares/general-error-handler';
import type { DependencyContainer } from '../services/DependencyContainer';

type AppHandleArgs = {
  routes?: (container: DependencyContainer) => Hono | Hono;
};

export const createCoreApp = (
  container: DependencyContainer,
  { routes }: AppHandleArgs = {},
) => {
  const app = new Hono().basePath('/core');

  app.use(secureHeaders());
  app.use(
    cors({
      allowHeaders: ['Content-Type'],
      credentials: true,
      origin: process.env.ALLOWED_ORIGIN
        ? (JSON.parse(process.env.ALLOWED_ORIGIN as string) as string[])
        : [],
    }),
  );
  app.use(
    apiKeyAuth({
      policies: container.config.ApiKeyPolicies,
      entityConfig: container.config.EntityConfig,
    }),
  );

  if (routes) {
    app.use('/app/*', customRouteGate());
    if (typeof routes !== 'function') {
      app.route('/app', routes);
    } else {
      app.route('/app', routes(container));
    }
  }

  app.route('/', setupCommonRoutes(container));

  // Unknown paths, after the API key check, so they don't reveal routes.
  app.notFound((c) =>
    c.json(
      {
        code: 'NOT_FOUND',
        message: `No route for ${c.req.method} ${c.req.path}`,
      },
      404,
    ),
  );
  // Errors no controller handled: logged with an ID, answered 500.
  app.onError(generalErrorHandler());

  return app;
};

export const appHandler =
  (container: DependencyContainer) => (args: AppHandleArgs) =>
    handle(createCoreApp(container, args));
