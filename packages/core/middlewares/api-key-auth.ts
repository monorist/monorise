import { createFactory } from 'hono/factory';
import httpStatus from 'http-status';

const factory = createFactory();

const API_KEYS: string[] = process.env.API_KEYS
  ? JSON.parse(process.env.API_KEYS as string)
  : [];

const apiKeyAuth = factory.createMiddleware(async (c, next) => {
  const xApiKey = c.req.header('x-api-key');

  // check if its public url
  if (c.req.url.match(/^\/core\/public\//)) {
    return await next();
  }

  if (!xApiKey || Array.isArray(xApiKey) || !API_KEYS.includes(xApiKey)) {
    c.status(httpStatus.UNAUTHORIZED);
    return c.json({
      status: httpStatus.UNAUTHORIZED,
      message: httpStatus['401_MESSAGE'],
    });
  }

  return await next();
});

export default apiKeyAuth;
