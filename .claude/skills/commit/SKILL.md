---
name: commit
description: Create a conventional commit on the current branch. Does NOT push. Ensures commit messages follow the Conventional Commits spec for automatic versioning with release-please.
argument-hint: [optional commit description]
---

# Conventional Commit

Create a git commit following the [Conventional Commits](https://www.conventionalcommits.org/) specification. This is required for release-please to auto-determine version bumps.

## Steps

1. **Check the current state** — run `git status` (no `-uall` flag) and `git diff --staged` to understand what's being committed. If nothing is staged, stage the relevant files (prefer specific files over `git add .`).

2. **Determine the commit type** from the changes:

   | Type | When to use | Version bump |
   |------|------------|--------------|
   | `feat` | New feature or capability | **minor** (0.x.0) |
   | `fix` | Bug fix | **patch** (0.0.x) |
   | `docs` | Documentation only | no release |
   | `style` | Formatting, whitespace, semicolons (no logic change) | no release |
   | `refactor` | Code restructuring (no feature/fix) | no release |
   | `perf` | Performance improvement | **patch** (0.0.x) |
   | `test` | Adding or fixing tests | no release |
   | `build` | Build system, dependencies, CI | no release |
   | `chore` | Maintenance, tooling, configs | no release |
   | `ci` | CI/CD pipeline changes | no release |
   | `revert` | Reverting a previous commit | depends on reverted type |

3. **Format the commit message** strictly as:
   ```
   type(scope): short description

   Optional longer body explaining the "why" (not the "what").

   BREAKING CHANGE: description (if applicable)
   ```

   Rules:
   - **type** is required, lowercase
   - **scope** is optional but encouraged — use the affected area (e.g., `composer`, `sync`, `settings`, `db`, `ui`, `ai`, `calendar`, `auth`, `search`, `shortcuts`, `tray`, `notifications`, `labels`, `filters`, `queue`, `imap`, `attachments`)
   - **description** starts lowercase, no period at end, imperative mood ("add" not "added")
   - **BREAKING CHANGE** footer triggers a **major** version bump — use sparingly
   - Keep the first line under 72 characters

4. **Examples:**
   ```
   feat(composer): add scheduled send with date picker
   fix(sync): handle expired Gmail history token gracefully
   refactor(db): consolidate migration helpers
   docs: update keyboard shortcuts table in CLAUDE.md
   chore(ci): add release-please workflow
   perf(search): use FTS5 trigram index for faster lookups
   feat(ai)!: switch to streaming responses

   BREAKING CHANGE: AI provider interface now requires stream() method
   ```

5. **Create the commit** using a HEREDOC for proper formatting:
   ```bash
   git commit -m "$(cat <<'EOF'
   type(scope): description
   EOF
   )"
   ```

6. **Stop. Do not push.**

   This skill commits and nothing else. It previously ran `git push` (and
   `git push -u origin HEAD` when there was no upstream) as an unconditional
   final step, which was wrong three ways:

   - It conflicts with `docs/methodology/02-work-loop.md`: work lands through a
     PR that CI gates, not by an agent pushing when it happens to be done.
   - It conflicts with the harness rule that an agent commits or pushes **only
     when asked**.
   - `git push -u origin HEAD` on a checked-out default branch pushes straight
     to `main`, which is protected — so the good case is a rejection and the bad
     case is a bypass.

7. **Refuse outright if the current branch is the default branch.** Check with
   `git rev-parse --abbrev-ref HEAD`. If it is `main` or `master`, do not commit:
   say so, and suggest a branch name based on the change type and scope.

8. **Print the follow-up commands rather than running them**, so the human
   decides when work leaves the machine:

   ```
   git push -u origin <branch>
   gh pr create --title "<type>(<scope>): <description>"
   ```

## User hint

$ARGUMENTS
