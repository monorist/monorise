---
name: opsx-ff
description: Fast-forward an EXISTING OpenSpec change to apply-ready using /skill:opsx-ff command. Use when the user types /skill:opsx-ff to fill in every remaining artifact of a change that already exists, in one pass. To create a NEW change, use /skill:opsx-propose instead.
---

Fast-forward an **existing** change — fill in every artifact it still needs, in one pass, until it is ready to implement.

**This skill does not create changes.** It takes one that exists and finishes it.

| You want to | Use |
|---|---|
| Create a new change and generate all its artifacts | `/skill:opsx-propose` |
| Finish an existing change, all remaining artifacts at once | `/skill:opsx-ff` (this) |
| Finish an existing change, one artifact at a time | `/skill:opsx-continue` |

**Input**: The change name. If omitted, infer it from conversation context; if that is ambiguous, list the active changes and ask.

**Steps**

1. **Select the change**

   If a name was given, use it. Otherwise:
   - Infer from conversation context if the user named one
   - Auto-select if exactly one active change exists
   - Otherwise run `openspec list --json` and use the **AskUserQuestion tool** to let the user pick

   Announce: "Fast-forwarding change: <name>" and how to override (`/skill:opsx-ff <other>`).

   **If the named change does not exist**, stop. Do NOT create it — say so and point at
   `/skill:opsx-propose`, which is the skill that creates a change. Silently creating one
   here is how `opsx-ff` and `opsx-propose` become the same skill.

2. **Read what is already there**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parse:
   - `applyRequires`: artifact IDs needed before implementation
   - `artifacts`: every artifact with its status and dependencies

   Report the starting position — "3 of 5 artifacts done, creating: specs, tasks" — so the
   user can see what this run will touch before it touches it.

   **If every `applyRequires` artifact is already `done`**, stop and say so. There is nothing
   to fast-forward; suggest `/skill:opsx-apply`.

3. **Create every remaining artifact, in dependency order**

   Use the **TodoWrite tool** to track progress.

   For each artifact that is `ready` (its dependencies are satisfied):
   - Get instructions:
     ```bash
     openspec instructions <artifact-id> --change "<name>" --json
     ```
   - The instructions JSON includes:
     - `context`: project background (a constraint for you — do NOT put it in the output)
     - `rules`: artifact-specific rules (likewise)
     - `template`: the structure your output file should follow
     - `instruction`: schema-specific guidance for this artifact type
     - `outputPath`: where to write it
     - `dependencies`: completed artifacts to read first
   - Read the completed dependency files for context
   - Write the artifact using `template` as its structure
   - Show progress: "✓ Created <artifact-id>"

   **Never overwrite an artifact that is already `done`.** Fast-forward means filling gaps,
   not regenerating work the user may have edited by hand.

   After each artifact, re-run `openspec status --change "<name>" --json` and continue until
   every ID in `applyRequires` is `done`.

   If an artifact genuinely needs input, use **AskUserQuestion**, then continue.

4. **Show final status**
   ```bash
   openspec status --change "<name>"
   ```

**Output**

- Change name and location
- Artifacts created **this run**, distinguished from those already present
- "All artifacts complete — ready for implementation."
- Prompt: "Run `/skill:opsx-apply` or ask me to implement to start working on the tasks."

**Artifact Creation Guidelines**

- Follow the `instruction` field from `openspec instructions` for each artifact type
- The schema defines what each artifact should contain — follow it
- Read dependency artifacts for context before creating a new one
- Use `template` as the structure for your output file and fill in its sections
- **IMPORTANT**: `context` and `rules` are constraints for YOU, not content for the file
  - Do NOT copy `<context>`, `<rules>`, `<project_context>` blocks into the artifact
  - They guide what you write; they should never appear in the output

**Guardrails**
- Operate only on an existing change; never create one
- Never regenerate an artifact already marked `done`
- Create every artifact the schema's `apply.requires` lists, not just the next one
- Always read dependency artifacts before creating one that depends on them
- If context is critically unclear, ask — but prefer a reasonable decision to stalling
- Verify each artifact file exists after writing before moving to the next
