# Monorise

Simplify Single table design

## Gitflow (How to develop)

![Gitflow](README/gitflow.png)

### Main branch

1. When `dev` is ready
1. Branch out from `dev` branch
1. Run `npm run changeset:dev-exit` to end dev mode
1. Create prerelease end PR to `main`
1. Review and merge
1. Stable version published

### Dev branch

1. Run `npm run changeset:dev-start` to start dev mode
1. Your PR merged into dev
1. Changesets bump version PR created / updated (when added new features/fixes)
1. Repeat 2-3 to keep adding new features/fixes
1. Changesets PR (step 2) merged
1. Publish as 0.X.X-dev.x

### Feature branch

1. Run `npm run changeset` to record summary of your changes
1. When ready for review, create PR and point to `dev` branch

