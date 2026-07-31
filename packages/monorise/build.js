#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
// Core and React declare different `transactional` builders, so star-exporting
// both would emit TS2308. Runtime star-exports already drop the ambiguous name
// (ESM semantics); enumerate Core and React exports here minus `transactional`
// so the type surface matches the runtime surface. Names exported by both
// (e.g. `Mutual`) resolve to Core's, matching star-export behavior.
const getDtsExportNames = (pkg) => {
  const dts = fs.readFileSync(path.join(distDir, pkg, 'index.d.ts'), 'utf-8');
  const names = new Set();
  const exportClause = /export\s+(?:type\s+)?\{([^}]*)\}/g;
  let match;
  while ((match = exportClause.exec(dts)) !== null) {
    for (const part of match[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        .trim();
      if (name && name !== 'default') {
        names.add(name);
      }
    }
  }
  if (names.size === 0) {
    throw new Error(`Failed to enumerate exports from ${pkg}/index.d.ts`);
  }
  return names;
};

const coreNames = getDtsExportNames('core');
coreNames.delete('transactional');
const reactNames = getDtsExportNames('react');
reactNames.delete('transactional');
for (const name of coreNames) {
  reactNames.delete(name);
}

const toExportClause = (names, pkg) =>
  `export {\n${[...names].map((name) => `  ${name},`).join('\n')}\n} from './${pkg}/index';`;

const mainIndexDtsContent = `// Re-export all packages from their respective modules
export * from './base/index';
${toExportClause(coreNames, 'core')}
${toExportClause(reactNames, 'react')}
export * from './sst/index';

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
