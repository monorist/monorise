import { Hono } from 'hono';
import { DependencyContainer } from 'monorise/core';
import config, { Entity } from '#/monorise/config';

const container = new DependencyContainer(config);

const app = new Hono();

app.get('/health', async (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/test', async (c) => {
  // Example: List users using the entity repository
  const entities = await container.entityRepository.listEntities({
    entityType: Entity.USER,
  });

  return c.json({ items: entities.items }, 200);
});

export default app;
