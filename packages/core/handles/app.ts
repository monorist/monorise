import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { setupCommonRoutes } from '../controllers/setupRoutes';
import apiKeyAuth from '../middlewares/api-key-auth';
import generalErrorHandler from '../middlewares/general-error-handler';
import type { DependencyContainer } from '../services/DependencyContainer';

type AppHandleArgs = {
  routes?: (container: DependencyContainer) => Hono | Hono;
};

export const appHandler =
  (container: DependencyContainer) =>
    ({ routes }: AppHandleArgs) => {
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
      app.use(apiKeyAuth);

      if (routes) {
        if (typeof routes !== 'function') {
          app.route('/app', routes);
        } else {
          app.route('/app', routes(container));
        }
      }

      app.route('/', setupCommonRoutes(container));

      app.use(generalErrorHandler());

      return handle(app);
    };
