import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  StandardError,
  StandardErrorCode,
} from '../../../errors/standard-error';
import { CreateMutualController } from '../../mutual/create-mutual.controller';
import { CreateEntityController } from '../create-entity.controller';
import { UpdateEntityController } from '../update-entity.controller';

// Both a taken unique value and a lost race answer 409, as a transaction's
// conflicts already do.
const failingWith = (code: StandardErrorCode) =>
  vi.fn().mockRejectedValue(new StandardError(code, 'conflict'));

const app = (service: Record<string, unknown>) => {
  const hono = new Hono();
  hono.post(
    '/entity/:entityType',
    new CreateEntityController(service as never).controller,
  );
  hono.patch(
    '/entity/:entityType/:entityId',
    new UpdateEntityController(service as never).controller,
  );
  hono.post(
    '/mutual/:byEntityType/:byEntityId/:entityType/:entityId',
    new CreateMutualController(service as never).controller,
  );
  return hono;
};

const send = (hono: Hono, method: string, path: string) =>
  hono.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  });

describe('conflict status', () => {
  it.each([
    StandardErrorCode.UNIQUE_VALUE_EXISTS,
    StandardErrorCode.TRANSACTION_CONFLICT,
  ])('answers 409 for %s on create and update', async (code) => {
    const hono = app({
      createEntity: failingWith(code),
      updateEntity: failingWith(code),
    });

    for (const [method, path] of [
      ['POST', '/entity/user'],
      ['PATCH', '/entity/user/u1'],
    ]) {
      const res = await send(hono, method, path);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe(code);
    }
  });

  it('answers 409 for a relationship write that lost a race', async () => {
    const res = await send(
      app({ createMutual: failingWith(StandardErrorCode.TRANSACTION_CONFLICT) }),
      'POST',
      '/mutual/user/u1/team/t1',
    );

    expect(res.status).toBe(409);
  });
});
