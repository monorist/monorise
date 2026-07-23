---
"@monorise/cli": minor
"monorise": minor
---

Enhanced CLI init command with full project scaffolding and example page

The `npx monorise init` command now creates a complete monorepo setup:
- Creates apps/ and services/ directory structure
- Scaffolds Next.js app in apps/web/
- Installs SST v4, monorise, hono, and zod
- Creates services/core/routes.ts with Hono app template
- Generates sst.config.ts with monorise module
- Configures monorise.config.ts with customRoutes
- Sets up tsconfig path aliases
- Creates example page.tsx demonstrating useEntities and createEntity
- Generates a starter Team entity and a shared createMutualConfig
  (monorise/mutuals/team-membership.ts), demonstrating a User <-> Team mutual
  relationship
- Runs initial monorise build

Simplified imports:
- `monorise dev`/`monorise build` now also generate `.monorise/index.ts`
  (re-exporting `.monorise/config.ts`), so generated types can be imported via
  `#/monorise` instead of `#/monorise/config`. The longer path keeps working
  for backward compatibility.

Documentation updates:
- Updated messaging to emphasize time-to-production
- Added "Ship in Hours" benefit
- Simplified getting started guide

Bug fix:
- Fixed www/package.json version field
