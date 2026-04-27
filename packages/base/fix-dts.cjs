// Post-build fix: tsup DTS bundling converts `export declare enum` to
// `declare enum` + re-export, which breaks `declare module` augmentation.
// This script restores `export` on the Entity enum declaration and removes
// the duplicate from the re-export statement.
const fs = require('fs');
const p = 'dist/index.d.ts';
let content = fs.readFileSync(p, 'utf-8');
// Add export to enum declaration
content = content.replace(/^declare enum Entity \{/m, 'export declare enum Entity {');
// Remove Entity from the re-export line (now exported on declaration)
// Handles: `Entity, ` or `, Entity` patterns — only match standalone Entity, not CreatedEntity etc.
content = content.replace(/\bEntity,\s*(?=type\b)/g, '');
content = content.replace(/,\s*Entity\b(?![\w])/g, '');
fs.writeFileSync(p, content);
