---
name: document-feature
description: Add help documentation for a new or changed feature. Updates the Help page content and project docs (docs/, CLAUDE.md); counts are verified by scripts/docs-check.mjs, not maintained by hand.
argument-hint: [feature description]
---

# Document Feature

You just implemented or modified a feature. Now add or update its documentation across all relevant files.

## What to do

1. **Read the current help content** at `src/constants/helpContent.ts` to understand the existing structure.

2. **Determine where the feature belongs.** Read the current categories from
   `src/constants/helpContent.ts` — that file is the source of truth, and the
   list below is a summary that can go stale. At the time of writing:
   - `getting-started` — First-time setup (accounts, sync, client ID)
   - `reading-email` — Thread view, reading pane, mark-as-read
   - `composing` — Compose, reply, undo send, schedule, signatures, templates, aliases, drafts
   - `search-navigation` — Search operators, command palette, keyboard shortcuts
   - `organization` — Labels, smart folders, filters, quick steps, star/pin/mute, archive/trash, multi-select, drag & drop
   - `productivity` — Snooze, follow-up reminders, split inbox, spam
   - `ai-features` — AI overview, summaries, smart replies, compose, Ask Inbox
   - `newsletters` — Newsletter bundles, unsubscribe
   - `notifications-contacts` — Notifications/VIP, contact sidebar
   - `security` — Phishing, auth badges, remote images, link confirmation
   - `calendar` — Google Calendar
   - `appearance` — Theme, accent colors, font/density, layout
   - `accounts-system` — Multi-account, system tray, global shortcut, pop-out windows

3. **Add a new `HelpCard`** to the appropriate category's `cards` array, or **update an existing card** if the feature enhances something already documented. Each card needs:
   ```ts
   {
     id: "kebab-case-unique-id",        // unique across ALL categories
     icon: SomeLucideIcon,              // import from lucide-react
     title: "Short user-facing title",  // what users see
     summary: "One-line summary shown when collapsed (~40-60 chars).",
     description: "Detailed explanation shown when the card is expanded. 3-5 sentences covering what it does, how it works, and practical details. Write from the USER's perspective, not a developer's.",
     tips?: [                           // optional but recommended
       { text: "How to use it or a useful detail" },
       { text: "Keyboard shortcut", shortcut: "key" },
     ],
     relatedSettingsTab?: "general",    // optional, must be a valid tab ID
   }
   ```

4. **Valid `relatedSettingsTab` values:** `general`, `composing`, `labels`, `filters`, `smart-folders`, `quickSteps`, `contacts`, `accounts`, `sync`, `shortcuts`, `ai`, `subscriptions`, `developer`

5. **If adding a contextual tip** (for `?` tooltips in the UI), add an entry to the `CONTEXTUAL_TIPS` record:
   ```ts
   "tip-id": {
     title: "Short title",
     body: "One sentence explaining the setting or feature.",
     helpTopic: "category-id",  // must match a category ID
   }
   ```

6. **Run the help content tests** to validate your additions:
   ```bash
   npx vitest run src/constants/helpContent.test.ts
   ```
   The tests check: unique IDs, non-empty titles/descriptions, valid settings tab references, valid contextual tip topic references.

7. **Run type-check** to make sure icon imports are correct:
   ```bash
   npx tsc --noEmit
   ```

8. **Update project docs** if the feature affects them. Check each file and update as needed:
   - `docs/architecture.md` — Update if the feature adds new component groups, services, stores, database tables, or changes the project structure tree.

     **Do not count anything by hand.** Run `npm run docs:check`; it measures
     migrations, tables, test files, stores and AI providers from the tree and
     names any documented number that disagrees. Hand-maintained counts are
     exactly what drifted six ways before audit P20 — including two different
     table counts in the same file. If a number is not worth keeping correct,
     delete it and point at the source instead of writing a new one.
   - `docs/development.md` — Update if new development workflows are introduced. Test counts are checked by `npm run docs:check`.
   - `docs/keyboard-shortcuts.md` — Update if the feature adds or changes keyboard shortcuts.
   - `CLAUDE.md` — Update the relevant section (component organization, service layer, key gotchas, etc.) to reflect the new feature.

## Writing guidelines

- Write from the **user's perspective**: "Snooze a thread to temporarily hide it" not "Sets the SNOOZED label via Gmail API"
- Keep descriptions to **2-3 sentences** max
- Include **keyboard shortcuts** in tips when the feature has them
- Add a **`relatedSettingsTab`** link when the feature has configurable options
- Pick an **icon** that visually represents the feature (browse lucide-react icons)

## Feature description

$ARGUMENTS
