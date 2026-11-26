import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectCombinedPackage } from './detect-package';

export type SearchManifest = {
  version: 1;
  // entity name → hash of its resolved search config
  entities: Record<string, string>;
};

type SearchConfigs = { name: string; search?: unknown }[];

/**
 * The `search` settings of monorise.config.ts, as the `SearchDefaults`
 * declaration of the generated config.ts.
 */
export function searchDefaultsDeclaration(defaults: unknown): string {
  return `const SearchDefaults = ${JSON.stringify(defaults ?? {})};`;
}

// The project's own base package, so hashes match what its Lambdas compute.
async function loadProjectBase(projectRoot: string) {
  const name = detectCombinedPackage(projectRoot)
    ? 'monorise/base'
    : '@monorise/base';
  const require = createRequire(path.join(projectRoot, 'package.json'));
  const base = await import(pathToFileURL(require.resolve(name)).href);
  if (typeof base.searchConfigHash !== 'function') {
    throw new Error(
      `'search' needs a newer ${name}: this version doesn't support the search index.`,
    );
  }
  return base;
}

/**
 * Writes .monorise/search-manifest.json with a hash of each indexed entity's
 * resolved search config. The SST component reruns the reindex when it
 * changes. Removed when no entity uses `search`.
 */
export async function writeSearchManifest(
  monoriseOutputDir: string,
  projectRoot: string,
  configs: SearchConfigs,
  defaults: unknown,
): Promise<void> {
  const manifestPath = path.join(monoriseOutputDir, 'search-manifest.json');
  const indexed = configs.filter((config) => config.search);
  if (!indexed.length) {
    fs.rmSync(manifestPath, { force: true });
    return;
  }

  const base = await loadProjectBase(projectRoot);
  if (defaults !== undefined) {
    base.validateSearchSettings(defaults, 'monorise.config.ts');
  }

  const manifest: SearchManifest = {
    version: 1,
    entities: Object.fromEntries(
      indexed.map((config) => [
        config.name,
        base.searchConfigHash(
          base.resolveSearchConfig(config.search, defaults),
        ),
      ]),
    ),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
