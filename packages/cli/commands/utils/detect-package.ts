import fs from 'node:fs';
import path from 'node:path';

/**
 * Detects whether the combined 'monorise' package is installed by walking up
 * the directory tree. This handles monorepo setups where dependencies are
 * hoisted to the root node_modules.
 */
export function detectCombinedPackage(startDir: string): boolean {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, 'node_modules', 'monorise'))) {
      return true;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return false;
}
