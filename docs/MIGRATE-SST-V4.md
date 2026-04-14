# Migrate to SST v4 / Monorise v1

This guide covers migrating Monorise projects from **SST v3** to **SST v4**.

## What Changed

SST v4 upgrades the underlying Pulumi AWS provider from v6 to v7. For Monorise users, this is primarily an infrastructure tooling change. No application code (entity configs, handlers, mutual definitions, tags) needs to change.

## Migration Steps

### 1. Update Dependencies

**If using the unified `monorise` package:**

```bash
npm install monorise@^1.0.0 sst@^4.0.0
```

**If using `@monorise/sst` directly:**

```bash
npm install @monorise/sst@^4.0.0 sst@^4.0.0
```

### 2. Regenerate SST Platform Types

```bash
npx sst install
```

### 3. Update `sst.config.ts` Imports (Unified Package Only)

If switching from `@monorise/sst` to the unified `monorise` package, update your import:

```typescript
// Before
const { monorise } = await import('@monorise/sst');

// After
const { monorise } = await import('monorise/sst');
```

### 4. Preview Infrastructure Changes

```bash
npx sst diff
```

**Watch for:** `replace` on the DynamoDB table. A replace means data loss. If you see this, stop and investigate before deploying.

### 5. Migrate Pulumi State

This is a **one-way migration**.

```bash
npx sst refresh
```

Repeat for each stage:

```bash
npx sst refresh --stage production
```

### 6. Deploy

```bash
npx sst deploy
```

## Troubleshooting

### `sst diff` shows no changes

This is the ideal outcome. It means the Pulumi AWS v7 provider sees the same infrastructure as v6.

### Type errors in `.sst/platform`

SST-generated platform code may report TypeScript errors when checked with strict `verbatimModuleSyntax`. These are in SST's generated files, not your code. `sst deploy` handles type checking internally.

### Missing AWS credentials

SST commands require valid AWS credentials. Ensure your profile is configured in `~/.aws/config` or set `AWS_PROFILE` before running `sst diff` / `sst refresh` / `sst deploy`.

## Backward Compatibility

There is **no dual-mode support** for SST v3. Monorise v1 (`@monorise/sst` v4.x) requires SST v4. Projects staying on SST v3 should continue using `@monorise/sst` v3.x.
