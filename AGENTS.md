# Monorise — AI Agent Guide

> This document provides essential context for AI coding agents working on the Monorise project.
> Last updated: March 2026

---

## Project Overview

Monorise is an open-source DynamoDB single-table toolkit that powers the core data layer for applications built on DynamoDB. It provides:

- **Shared data model** — Schema definitions using Zod that work across backend and frontend
- **Ready-made API surface** — REST endpoints for entities, mutuals (relationships), and tags
- **Background processors** — Event-driven processors to keep denormalized access patterns in sync

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Entity** | A first-class record (e.g., `user`, `course`, `order`) with typed schema |
| **Mutual** | A bidirectional relationship between two entities that can hold data (e.g., `learner` ↔ `course` with progress/role/status) |
| **Tag** | Key/value access patterns to quickly query subsets of entities with O(1) performance |
| **Prejoin** | Computed relationship that "joins" through a chain of mutuals to avoid multi-hop queries |

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Language** | TypeScript 5.x |
| **Runtime** | Node.js 20+ (ESM only) |
| **Build Tool** | tsup (for packages), Turbo (monorepo orchestration) |
| **Database** | DynamoDB (single-table design) |
| **API Framework** | Hono (lightweight, Express-like) |
| **IaC** | SST v3 (Serverless Stack) for AWS infrastructure |
| **State Management** | Zustand (React client) |
| **Validation** | Zod |
| **Testing** | Vitest |
| **Linting/Formatting** | Biome |
| **Package Manager** | npm 10+ with workspaces |
| **Versioning** | Changesets |

---

## Monorepo Structure

```
monorise/
├── packages/
│   ├── base/          # @monorise/base — Entity config + shared types (Zod schemas)
│   ├── core/          # @monorise/core — Hono API, DynamoDB repositories, processors
│   ├── cli/           # @monorise/cli — Code generator (monorise dev/build/init commands)
│   ├── react/         # @monorise/react — Client SDK, React hooks, Zustand stores
│   ├── sst/           # @monorise/sst — SST v3 module (infrastructure components)
│   └── monorise/      # Combined package — re-exports all above for easier consumption
├── src/               # Re-export entry points for the combined monorise package
│   ├── core/index.ts
│   ├── react/index.ts
│   └── sst/index.ts
├── examples/          # Example projects (basic, ledger, websocket-chat)
├── www/               # Documentation website
├── docs/              # Additional documentation (CONCEPT.MD, etc.)
├── scripts/           # Build/utility scripts
└── .changeset/        # Changesets configuration
```

### Package Dependencies

```
base (no deps)
  ↓
core → depends on base
  ↓
react → depends on base
  ↓
sst → depends on SST v3 (peer)
  ↓
cli → independent (chokidar, tsx, tsconfig-paths)
  ↓
monorise → combines all above
```

---

## Build System

### Key Commands

```bash
# Install dependencies
npm install

# Development (watch/build all packages)
npm run dev

# Build all packages
npm run build

# Build the unified monorise package only
npm run build:monorise

# Run tests
npm test                    # Runs core package tests (vitest)

# Start local test environment
npm run start:test-env     # Starts Docker containers for testing

# Documentation
npm run docs:dev            # Start docs dev server
npm run docs:build          # Build docs

# Changesets (version management)
npm run changeset           # Create a changeset
npm run version             # Version packages
npm run release             # Build and publish
```

### Turbo Configuration

The monorepo uses Turbo for task orchestration:

- `turbo run build` — Builds all packages with caching
- `turbo run dev` — Runs all packages in watch mode
- Caches `dist/**` outputs

### Package Build (tsup)

Each package uses `tsup` with consistent config:

```typescript
// tsup.config.ts pattern
export default defineConfig({
  entry: ['index.ts'],
  format: ['esm'],        // ESM only
  dts: true,              // Generate TypeScript declarations
  sourcemap: true,        // Generate source maps
  clean: true,            // Clean output before build
});
```

### Unified Package Build

The `packages/monorise` package creates a unified bundle:

1. Copies `dist` from all sub-packages into `packages/monorise/dist/{base,core,react,sst,cli}/`
2. Rewrites `@monorise/*` imports to relative paths in `.d.ts` files
3. Creates main index files that re-export everything

---

## Code Organization

### `@monorise/base` — Entity Configuration

**Files:**
- `index.ts` — Main exports
- `types/monorise.type.ts` — Core type definitions (`Entity`, `CreatedEntity`, `MonoriseEntityConfig`)
- `utils/index.ts` — `createEntityConfig()` helper

**Purpose:**
- Defines the shared entity configuration format using Zod
- Provides type-safe entity definitions that work in both frontend and backend
- Entity configs include: name, schemas (base/create), mutual relationships, tags

### `@monorise/core` — Backend Core

**Directory Structure:**

```
packages/core/
├── controllers/           # Hono route handlers
│   ├── entity/           # CRUD endpoints for entities
│   ├── mutual/           # Mutual relationship endpoints
│   ├── tag/              # Tag query endpoints
│   └── setupRoutes.ts    # Route registration
├── data/                 # Data layer
│   ├── abstract/         # Base classes (Item.base.ts, Repository.base.ts)
│   ├── Entity.ts         # Entity model and repository
│   ├── Mutual.ts         # Mutual model and repository
│   ├── Tag.ts            # Tag repository
│   ├── EventUtils.ts     # EventBridge utilities
│   └── __tests__/        # Unit tests
├── services/             # Business logic
│   ├── entity.service.ts
│   ├── mutual.service.ts
│   └── DependencyContainer.ts
├── processors/           # Background event processors
│   ├── create-entity-processor.ts
│   ├── mutual-processor.ts
│   ├── tag-processor.ts
│   ├── prejoin-processor.ts
│   └── replication-processor.ts
├── middlewares/          # Hono middlewares
│   ├── api-key-auth.ts
│   ├── entity-type-check.ts
│   └── general-error-handler.ts
├── errors/               # Error classes
│   ├── standard-error.ts
│   ├── api-error.ts
│   └── extendable-error.ts
├── handles/              # Lambda handlers
│   └── app.ts            # Main Hono app handler
└── helpers/              # Utility functions
```

**Key Files:**
- `index.ts` — CoreFactory class that wires everything together
- `controllers/setupRoutes.ts` — Registers all API routes
- `handles/app.ts` — Lambda handler factory

### `@monorise/cli` — Code Generator

**Files:**
- `cli.ts` — Main CLI entry point
- `commands/dev.ts` — Watch mode for entity configs
- `commands/build.ts` — One-time build
- `commands/utils/generate.ts` — File generation logic

**Generated Files (in consumer projects):**
- `.monorise/config.ts` — Aggregated entity enum and type definitions
- `.monorise/handle.ts` — Lambda handlers wired with config

**CLI Commands:**
- `monorise init` — Initialize project with starter config
- `monorise dev` — Watch entity configs and regenerate
- `monorise build` — Generate config files once

### `@monorise/react` — Frontend SDK

**Directory Structure:**

```
packages/react/
├── actions/              # State actions
│   ├── app.action.ts
│   ├── auth.action.ts
│   ├── config.action.ts
│   └── core.action.ts
├── lib/                  # Utilities
│   ├── api.ts           # Axios setup
│   ├── constant.ts
│   ├── entity.ts
│   └── utils.ts
├── services/            # API services
│   ├── auth.service.ts
│   ├── core.service.ts
│   └── filestore.service.ts
├── store/               # Zustand stores
│   └── monorise.store.ts
└── types/               # Type definitions
    ├── api.type.ts
    ├── axios.type.ts
    ├── monorise.type.ts
    └── mutual.type.ts
```

### `@monorise/sst` — Infrastructure

**Files:**
- `index.ts` — Module exports
- `components/monorise-core.ts` — Main SST component
- `components/single-table.ts` — DynamoDB table component
- `components/q-function.ts` — Queue function component
- `components/dashboard.ts` — Optional dashboard
- `constants/` — Table keys, event names

---

## Development Conventions

### Code Style (Biome)

Configuration in `biome.json`:

- **Indent:** 2 spaces
- **Line width:** 80 characters
- **Quotes:** Single quotes
- **Trailing commas:** Always
- **Semicolons:** Always
- **Line ending:** LF

**Lint/Format commands:**
```bash
npx @biomejs/biome check .      # Check files
npx @biomejs/biome check --apply .  # Fix issues
npx @biomejs/biome format .     # Format files
```

### Import Conventions

- Use ESM imports with `.js` extension for local files
- External packages use bare imports
- Internal monorepo packages use `@monorise/*` during development, `monorise/*` in unified package

### TypeScript Configuration

- Base config extends `@tsconfig/node20`
- Target: ES2016
- Module: CommonJS (for compatibility)
- Module resolution: Node
- Strict mode enabled
- Declaration files generated with source maps

### Naming Conventions

- **Files:** kebab-case for multi-word files (e.g., `entity-type-check.ts`)
- **Classes:** PascalCase (e.g., `EntityService`, `DependencyContainer`)
- **Functions/Variables:** camelCase
- **Constants:** SCREAMING_SNAKE_CASE for true constants
- **Types/Interfaces:** PascalCase with descriptive names
- **Entity names:** lower-kebab-case (e.g., `user`, `learning-activity`)

### Error Handling

- Use `StandardError` with `StandardErrorCode` enum for known errors
- Extend `ExtendableError` for custom error classes
- API errors use `ApiError` class with HTTP status codes

---

## Testing

### Test Setup

- **Framework:** Vitest
- **Config:** `packages/core/vitest.config.ts`
- **Globals enabled:** Yes (describe, test, expect available globally)
- **Environment:** Node.js

### Running Tests

```bash
npm test              # Run all core tests
npx vitest            # Run in watch mode
npx vitest run        # Run once (CI mode)
```

### Test Files

Located alongside source files:
- `packages/core/data/__tests__/Entity.test.ts`
- `packages/core/data/__tests__/Mutual.test.ts`

### Test Utilities

- `packages/core/helpers/test/test-utils.ts` — Test helpers

---

## Release Process

### Changesets

The project uses [Changesets](https://github.com/changesets/changesets) for version management:

1. Make your changes
2. Run `npm run changeset` — Select affected packages and describe changes
3. Commit the changeset file
4. Create PR — CI validates the changeset
5. Merge — Changeset bot creates a "Version Packages" PR
6. Release — Merge the version PR, then run `npm run release`

### Versioning Strategy

- Follows semantic versioning (semver)
- Independent versioning per package
- Linked packages get same version bumps when appropriate

---

## Working with Entity Configs

### Basic Entity Config

```typescript
import { createEntityConfig } from '@monorise/base';
import { z } from 'zod';

const baseSchema = z.object({
  displayName: z.string().min(1),
  email: z.string().email(),
}).partial();

const createSchema = baseSchema.extend({
  displayName: z.string().min(1),  // Required for creation
});

const config = createEntityConfig({
  name: 'user',                    // lower-kebab-case
  displayName: 'User',
  baseSchema,
  createSchema,
  searchableFields: ['displayName', 'email'],
  uniqueFields: ['email'],
});

export default config;
```

### With Mutuals

```typescript
const config = createEntityConfig({
  name: 'learner',
  baseSchema,
  mutual: {
    mutualSchema: z.object({
      progress: z.number(),
      enrolledAt: z.string(),
    }),
    mutualFields: {
      courses: {
        entityType: 'course',
        mutualDataProcessor: (mutualIds, currentMutual) => ({
          enrolledAt: new Date().toISOString(),
        }),
      },
    },
  },
});
```

### With Tags

```typescript
const config = createEntityConfig({
  name: 'organization',
  baseSchema,
  tags: [
    {
      name: 'region',
      processor: (entity) => [
        { group: entity.data.region },
      ],
    },
    {
      name: 'status',
      processor: (entity) => [
        { sortValue: entity.data.activatedAt },
      ],
    },
  ],
});
```

---

## Common Patterns

### Adding a New Entity

1. Create `monorise/entities/{entity-name}.ts` with config
2. Run `npx monorise dev` or `npx monorise build` to regenerate
3. Use generated types in your code

### Adding a Custom Route

1. Create routes file exporting a Hono instance
2. Add `customRoutes: './path/to/routes.ts'` in `monorise.config.ts`
3. Regenerate with `monorise build`

### Adding a Processor

Background processors handle eventual consistency:
- **Mutual processor** — Creates bidirectional relationship records
- **Tag processor** — Syncs tag indices when entities change
- **Prejoin processor** — Computes derived relationships through chains
- **Replication processor** — Keeps denormalized copies in sync via streams

---

## Security Considerations

- **API Key Authentication** — Uses `x-api-key` header (configured in SST)
- **Entity Type Validation** — Middleware checks entity types against config
- **Input Validation** — All inputs validated against Zod schemas
- **Conditional Writes** — DynamoDB uses condition expressions to prevent race conditions
- **Type Safety** — Full TypeScript coverage prevents many runtime errors

---

## Troubleshooting

### Common Issues

**Build fails with type errors:**
```bash
npm run clear-dist    # Clear all dist directories
npm run build         # Rebuild everything
```

**CLI not finding entity configs:**
- Ensure `monorise.config.ts` exists in project root
- Check `configDir` path is correct
- Verify entity file names end in `.ts` (not `.tsx`)

**Type errors in unified package:**
- Run `npm run build` in individual packages first
- Then run `npm run build:monorise` to aggregate

**DynamoDB Local issues:**
```bash
npm run start:test-env    # Start local DynamoDB
```

---

## References

- **Main README:** `README.md`
- **Concept Guide:** `docs/CONCEPT.MD`
- **Contributing Guide:** `CONTRIBUTING.md`
- **Roadmap:** `ROADMAP.md`
- **Package READMEs:** Individual `packages/*/README.md` files

---

## Quick Reference

| Task | Command |
|------|---------|
| Install | `npm install` |
| Dev mode | `npm run dev` |
| Build all | `npm run build` |
| Test | `npm test` |
| Lint | `npx @biomejs/biome check .` |
| Format | `npx @biomejs/biome format --write .` |
| Create changeset | `npm run changeset` |
| Release | `npm run release` |
| CLI init | `npx @monorise/cli init` |
| CLI dev | `npx monorise dev` |
| CLI build | `npx monorise build` |
