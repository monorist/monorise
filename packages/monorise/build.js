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

// Create the main index.js file that re-exports everything
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

// Create the main index.d.ts file
const mainIndexDtsContent = `// Re-export all packages from their respective modules
export * from './base/index';
export * from './core/index';
export * from './react/index';
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
