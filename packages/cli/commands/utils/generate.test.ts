import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateConfigFile } from './generate';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Fixtures are written inside the package tree (not `os.tmpdir()`) so a dynamically-imported
// fixture file's `import { z } from 'zod'` resolves via the ordinary node_modules walk-up —
// `zod` is hoisted to the monorepo root, not duplicated into packages/cli/node_modules, and a
// system tmpdir sits outside that tree entirely.
function makeFixtureDirs() {
  const root = path.join(dirname, `.generate-test-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const configDir = path.join(root, 'config');
  const outDir = path.join(root, 'out');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  return { root, configDir, outDir };
}

test('generateConfigFile throws when a mutual config has both asEntity and an independently-authored mutualDataSchema (bypassing createMutualConfig)', async () => {
  const { root, configDir, outDir } = makeFixtureDirs();

  try {
    fs.writeFileSync(
      path.join(configDir, 'student.ts'),
      `
      import { z } from 'zod';
      // Hand-rolled mutual object bypassing createMutualConfig's own runtime guard — this
      // exercises generate.ts's own build-time defense-in-depth check, which must catch a
      // mutual config that satisfies the MutualConfig shape without going through the factory.
      const badMutual = {
        entities: ['student', 'course'],
        mutualDataSchema: z.object({ role: z.string() }),
        asEntity: { name: 'enrollment', finalSchema: z.object({ role: z.string() }) },
      };
      export default {
        name: 'student',
        displayName: 'Student',
        baseSchema: z.object({ name: z.string() }).partial(),
        mutual: {
          mutualSchema: z.object({ courseIds: z.string().array() }).partial(),
          mutualFields: {
            courseIds: { entityType: 'course', mutual: badMutual },
          },
        },
      };
      `,
    );
    fs.writeFileSync(
      path.join(configDir, 'course.ts'),
      `
      import { z } from 'zod';
      export default {
        name: 'course',
        displayName: 'Course',
        baseSchema: z.object({ title: z.string() }).partial(),
      };
      `,
    );

    await assert.rejects(
      () => generateConfigFile(configDir, outDir),
      /both 'asEntity' and an independently-authored 'mutualDataSchema'/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generateConfigFile throws when a mutual config has asEntity set but mutualDataSchema is entirely omitted (bypassing createMutualConfig)', async () => {
  const { root, configDir, outDir } = makeFixtureDirs();

  try {
    fs.writeFileSync(
      path.join(configDir, 'student.ts'),
      `
      import { z } from 'zod';
      // Hand-rolled mutual object bypassing createMutualConfig's own runtime guard — asEntity is
      // set but mutualDataSchema is not just mismatched, it's OMITTED entirely. This must still
      // be caught at build time (and must not silently skip mutualPairs codegen either).
      const badMutual = {
        entities: ['student', 'course'],
        asEntity: { name: 'enrollment', finalSchema: z.object({ role: z.string() }) },
      };
      export default {
        name: 'student',
        displayName: 'Student',
        baseSchema: z.object({ name: z.string() }).partial(),
        mutual: {
          mutualSchema: z.object({ courseIds: z.string().array() }).partial(),
          mutualFields: {
            courseIds: { entityType: 'course', mutual: badMutual },
          },
        },
      };
      `,
    );
    fs.writeFileSync(
      path.join(configDir, 'course.ts'),
      `
      import { z } from 'zod';
      export default {
        name: 'course',
        displayName: 'Course',
        baseSchema: z.object({ title: z.string() }).partial(),
      };
      `,
    );

    await assert.rejects(
      () => generateConfigFile(configDir, outDir),
      /'asEntity' set but 'mutualDataSchema' is missing/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generateConfigFile does not throw for a mutual config built through createMutualConfig with asEntity set (mutualDataSchema === asEntity.finalSchema by reference)', async () => {
  const { root, configDir, outDir } = makeFixtureDirs();

  try {
    fs.writeFileSync(
      path.join(configDir, 'student.ts'),
      `
      import { z } from 'zod';
      // Mirrors what createMutualConfig itself produces: mutualDataSchema is the exact SAME
      // object reference as asEntity.finalSchema, not an independently-authored one.
      const enrollmentFinalSchema = z.object({ role: z.string() });
      const goodMutual = {
        entities: ['student', 'course'],
        asEntity: { name: 'enrollment', finalSchema: enrollmentFinalSchema },
        mutualDataSchema: enrollmentFinalSchema,
      };
      export default {
        name: 'student',
        displayName: 'Student',
        baseSchema: z.object({ name: z.string() }).partial(),
        // generateConfigFile also feeds every config into the analytics manifest writer, which
        // expects a real createEntityConfig(...)-shaped module (i.e. carrying finalSchema) —
        // matching the fixture style analytics-manifest.test.ts itself uses.
        finalSchema: z.object({ name: z.string() }).partial(),
        mutual: {
          mutualSchema: z.object({ courseIds: z.string().array() }).partial(),
          mutualFields: {
            courseIds: { entityType: 'course', mutual: goodMutual },
          },
        },
      };
      `,
    );
    fs.writeFileSync(
      path.join(configDir, 'course.ts'),
      `
      import { z } from 'zod';
      export default {
        name: 'course',
        displayName: 'Course',
        baseSchema: z.object({ title: z.string() }).partial(),
        finalSchema: z.object({ title: z.string() }).partial(),
      };
      `,
    );

    const outputPath = await generateConfigFile(configDir, outDir);
    assert.equal(outputPath, path.join(outDir, 'config.ts'));
    assert.ok(fs.existsSync(outputPath));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
