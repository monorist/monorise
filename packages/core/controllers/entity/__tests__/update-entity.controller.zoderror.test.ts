import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { UpdateEntityController } from '../update-entity.controller';

// Regression test for a bug that ONLY manifests in a bundled deployment, which
// is why it survived so long: the controllers used to brand-check with
// `err.constructor?.name === 'ZodError'`, and a bundler renames the class.
// Observed as `_ZodError` in a plain bundle and as `r` under `--minify`, so
// every service-level validation error fell through to the generic 500 handler
// instead of returning 400.
//
// Unbundled source keeps the original class name, so unit tests, local runs and
// a reviewer's local verification all pass either way — no ordinary test would
// have caught it. Subclassing reproduces the exact shape the bundler produces
// (constructor name differs, instance `name` does not) without needing esbuild
// in the test run:
//
//   constructor.name -> '_RenamedZodError'   old predicate: false
//   .name            -> 'ZodError'           new predicate: true
//
// `name` is an OWN instance property that zod sets in its constructor, so it is
// immune to identifier renaming.
class _RenamedZodError extends ZodError {}

// Minimal duck-typed Hono context — the wrapped callback only touches
// req.header/req.param/req.json and c.status/c.json, matching the pattern in
// upsert-entity.controller.test.ts.
function fakeContext(body: object) {
  let statusCode = 200;
  return {
    req: {
      header: () => undefined,
      param: () => ({ entityType: 'competition', entityId: 'comp-1' }),
      json: async () => body,
    },
    status: (code: number) => {
      statusCode = code;
    },
    json: (data: unknown) => ({ status: statusCode, data }),
  } as any;
}

describe('UpdateEntityController — ZodError detection survives class renaming', () => {
  it('maps a ZodError whose class has been renamed to 400, not 500', async () => {
    const renamed = new _RenamedZodError([
      { code: 'custom', path: [], message: 'x' },
    ]);

    // Guard the premise itself: if a future zod version stops setting `name` as
    // an own property, this assertion fails loudly rather than the test quietly
    // passing for the wrong reason.
    expect(renamed.constructor.name).not.toBe('ZodError');
    expect(renamed.name).toBe('ZodError');

    const entityService = {
      updateEntity: vi.fn().mockRejectedValue(renamed),
    } as any;
    const controller = new UpdateEntityController(entityService);

    const result = await controller.controller(
      fakeContext({ someField: 'value' }),
      async () => {},
    );

    expect((result as any).status).toBe(400);
    expect((result as any).data.code).toBe('API_VALIDATION_ERROR');
    // flatten() still produces the response body for a whole-payload complaint
    // (empty path -> formErrors).
    expect((result as any).data.details.formErrors).toContain('x');
  });

  it('still maps a plain ZodError to 400', async () => {
    const entityService = {
      updateEntity: vi
        .fn()
        .mockRejectedValue(
          new ZodError([{ code: 'custom', path: [], message: 'y' }]),
        ),
    } as any;
    const controller = new UpdateEntityController(entityService);

    const result = await controller.controller(
      fakeContext({ someField: 'value' }),
      async () => {},
    );

    expect((result as any).status).toBe(400);
    expect((result as any).data.code).toBe('API_VALIDATION_ERROR');
  });
});
