#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure dist directory exists
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Create subdirectories for each package and copy their dist files
const packages = ['base', 'core', 'react', 'sst', 'cli'];

packages.forEach((pkg) => {
  const sourceDir = path.join(__dirname, '..', pkg, 'dist');
  const targetDir = path.join(distDir, pkg);

  if (!fs.existsSync(sourceDir)) {
    console.warn(
      `Warning: ${pkg} package dist directory not found at ${sourceDir}`,
    );
    return;
  }

  // Copy the entire dist directory
  copyDirectory(sourceDir, targetDir);
  console.log(`Copied ${pkg} package files`);
});

// Rewrite @monorise/* imports in .d.ts files to relative paths
const packageMap = {
  '@monorise/base': 'base',
  '@monorise/core': 'core',
  '@monorise/react': 'react',
  '@monorise/sst': 'sst',
  '@monorise/cli': 'cli',
};

function rewriteImports(dir, currentPkg, extensions = ['.d.ts']) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteImports(fullPath, currentPkg, extensions);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      let content = fs.readFileSync(fullPath, 'utf-8');
      const original = content;
      for (const [pkg, folder] of Object.entries(packageMap)) {
        if (folder === currentPkg && extensions.includes(".js")) continue;
        const relativePath = path.relative(
          path.dirname(fullPath),
          path.join(distDir, folder, 'index'),
        );
        let relativeImport = relativePath.startsWith('.')
          ? relativePath
          : `./${relativePath}`;
        // Add .js extension for JS files (ESM requires explicit extension)
        if (extensions.includes('.js')) {
          relativeImport += '.js';
        }
        const escapedPkg = pkg.replace('/', '\\/');
        // Match both single and double quoted from/import patterns
        // e.g. from '@monorise/base', from "@monorise/base", import("@monorise/base")
        content = content.replace(
          new RegExp(`'${escapedPkg}'`, 'g'),
          `'${relativeImport}'`,
        );
        content = content.replace(
          new RegExp(`"${escapedPkg}"`, 'g'),
          `"${relativeImport}"`,
        );
      }
      if (content !== original) {
        fs.writeFileSync(fullPath, content);
      }
    }
  }
}

packages.forEach((pkg) => {
  const targetDir = path.join(distDir, pkg);
  if (fs.existsSync(targetDir)) {
    rewriteImports(targetDir, pkg, ['.d.ts']);
    console.log(`Rewrote @monorise/* imports in ${pkg} .d.ts files`);
    rewriteImports(targetDir, pkg, ['.js']);
    console.log(`Rewrote @monorise/* imports in ${pkg} .js files`);
  }
});

// Create the main index.js file that re-exports everything.
const mainIndexContent = `// Re-export all packages from their respective modules
export * from './base/index.js';
export * from './core/index.js';
export * from './react/index.js';
export * from './sst/index.js';

// Also provide named exports for each package
export * as base from './base/index.js';
export * as core from './core/index.js';
export * as react from './react/index.js';
export * as sst from './sst/index.js';
`;

fs.writeFileSync(path.join(distDir, 'index.js'), mainIndexContent);

// Create the main index.d.ts file.
// ESM star-exports drop ambiguous names from the runtime namespace (e.g.
// `transactional`, declared by both Core and React, and `Entity`, exported as
// different values by base and Core), while TS reports TS2308 for them. To
// keep the type surface identical to the runtime surface, enumerate every
// package's exports explicitly: names ambiguous at runtime are omitted, and
// names declared by more than one package are claimed by the first package
// listed (same-symbol re-exports from base, and type-only re-exports such as
// React's `Mutual`, which tsup elides at runtime).
const dtsPackages = ['core', 'base', 'react', 'sst'];

const runtimeAmbiguous = async () => {
  const counts = new Map();
  for (const pkg of dtsPackages) {
    const mod = await import(
      pathToFileURL(path.join(distDir, pkg, 'index.js')).href
    );
    for (const name of Object.keys(mod)) {
      if (name !== 'default') {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return new Set(
    [...counts].filter(([, count]) => count > 1).map(([name]) => name),
  );
};

const getDtsExportNames = (pkg) => {
  const dts = fs.readFileSync(path.join(distDir, pkg, 'index.d.ts'), 'utf-8');
  const names = new Set();
  let match;
  const exportClause = /export\s+(?:type\s+)?\{([^}]*)\}/g;
  while ((match = exportClause.exec(dts)) !== null) {
    for (const part of match[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        .trim()
        .replace(/^type\s+/, '');
      if (name && name !== 'default') {
        names.add(name);
      }
    }
  }
  const exportDeclare =
    /export\s+declare\s+(?:const|let|var|function|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g;
  while ((match = exportDeclare.exec(dts)) !== null) {
    names.add(match[1]);
  }
  if (names.size === 0) {
    throw new Error(`Failed to enumerate exports from ${pkg}/index.d.ts`);
  }
  return names;
};

const ambiguous = await runtimeAmbiguous();
const claimed = new Set();
const dtsClauses = dtsPackages
  .map((pkg) => {
    const names = [...getDtsExportNames(pkg)].filter(
      (name) => !ambiguous.has(name) && !claimed.has(name),
    );
    for (const name of names) {
      claimed.add(name);
    }
    if (names.length === 0) {
      return '';
    }
    return `export {\n${names.map((name) => `  ${name},`).join('\n')}\n} from './${pkg}/index';`;
  })
  .filter(Boolean)
  .join('\n');

const mainIndexDtsContent = `// Re-export all packages from their respective modules
${dtsClauses}

// Also provide named exports for each package
export * as base from './base/index';
export * as core from './core/index';
export * as react from './react/index';
export * as sst from './sst/index';
`;

fs.writeFileSync(path.join(distDir, 'index.d.ts'), mainIndexDtsContent);

console.log('Monorise package build completed successfully!');

// Helper function to copy directory recursively
function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
