---
"@monorise/cli": patch
"monorise": patch
---

Removing an entity, a named mutual or a field no longer fails the build with "Supply an explicit analytics migration", which pointed to a mechanism that doesn't exist. It prints a warning saying what happens to the data already written. Changing a field to an incompatible type still fails, with guidance: add a field with a new name instead.
