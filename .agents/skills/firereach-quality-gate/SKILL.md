---
name: firereach-quality-gate
description: >-
  Verification, accessibility, security, and release checklist for FireReach Medan.
  Use before committing, opening a PR, or changing module status to ready-for-review
  or active.
---

# FireReach Quality Gate

Follow `AGENTS.md`, `DESIGN.md`, and `docs/DATABASE_DESIGN.md` before finishing any task.

## Required Checks

1. **Automated checks**: Run `npm run lint`, `npm run test`, `npm run build`, and `npm run test:e2e`. Report exact pass/fail output; never claim unexecuted checks passed.
2. **UI & Accessibility (Anti-Slop + WCAG AA)**:
   - Run the Anti-Slop Delivery Gate from `.agents/skills/antislop/SKILL.md`.
   - Verify text contrast >= 4.5:1 (normal) and >= 3:1 (large text / UI borders) against `DESIGN.md` tokens.
   - Verify keyboard navigation (`Tab`, `Enter`, `Space`, `Escape`), visible focus rings, no horizontal overflow at desktop/mobile, working loading/empty/error states, and zero em dashes in UI/docs copy.
3. **Database & Security**:
   - Confirm `.env` is gitignored and `.env.example` holds empty placeholders only.
   - Confirm zero `service_role` keys or credentials exist in `src/`, `public/`, or committed files.
   - Confirm RLS is enabled on every `public` table with scoped policies (no `allow all` write shortcuts).
4. **Repository Hygiene**:
   - Run `git status --short` and remove any temporary debug files, throwaway scripts, or unused artifacts created during the session while preserving test suites and fixtures.
