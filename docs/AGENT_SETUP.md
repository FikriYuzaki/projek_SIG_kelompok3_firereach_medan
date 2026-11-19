# Agent Setup & Installed Skills

This repository standardizes AI coding assistant context at project scope so every team member gets identical architectural, geospatial, database, and UI quality rules.

## 1. Installed Project-Scoped Skills

All skills live under `.agents/skills/` (registered in `skills-lock.json`) and are referenced from root `AGENTS.md`:

| Skill Name | Source | Purpose | Path |
|---|---|---|---|
| `antislop` | `miqdadbadjuber/anti-slop` | Core UI, copy, accessibility, and code quality filter | `.agents/skills/antislop/SKILL.md` |
| `antislop-ui` | `miqdadbadjuber/anti-slop` | Visual hierarchy, layout, color, motion, performance | `.agents/skills/antislop-ui/SKILL.md` |
| `antislop-human` | `miqdadbadjuber/anti-slop` | WCAG AA contrast checker (`contrast-check.py`), keyboard, states | `.agents/skills/antislop-human/SKILL.md` |
| `antislop-layoutmobile` | `miqdadbadjuber/anti-slop` | Multi-breakpoint reflow, overflow checks, 44px tap targets | `.agents/skills/antislop-layoutmobile/SKILL.md` |
| `antislop-copywriting` | `miqdadbadjuber/anti-slop` | Anti-AI copy rules, zero em dashes, evidence-based prose | `.agents/skills/antislop-copywriting/SKILL.md` |
| `antislop-code` | `miqdadbadjuber/anti-slop` | Code comment hygiene without touching executable logic | `.agents/skills/antislop-code/SKILL.md` |
| `supabase` | `supabase/agent-skills` | Current Supabase JS/CLI/RLS/PostGIS workflows | `.agents/skills/supabase/SKILL.md` |
| `supabase-postgres-best-practices` | `supabase/agent-skills` | Postgres schema design, GiST/B-tree indexing, RLS performance | `.agents/skills/supabase-postgres-best-practices/SKILL.md` |
| `firereach-geospatial` | Custom project skill | CRS (`EPSG:32647` / `EPSG:4326`), accuracy taxonomy, module boundaries | `.agents/skills/firereach-geospatial/SKILL.md` |
| `firereach-modular-development` | Custom project skill | Ownership folders, `manifest`/`mount`/`unmount` contract, DEMO rules | `.agents/skills/firereach-modular-development/SKILL.md` |
| `firereach-data-provenance` | Custom project skill | Raw data archival, SHA-256 register, anti-fabrication rules | `.agents/skills/firereach-data-provenance/SKILL.md` |
| `firereach-quality-gate` | Custom project skill | Pre-PR lint, tests, WCAG AA, RLS, and hygiene gate | `.agents/skills/firereach-quality-gate/SKILL.md` |

### Installation Command Used

Anti-Slop and Supabase skills were installed non-interactively at project scope into `.agents/skills/` for Antigravity without duplicate installations:

```bash
npx --yes skills add miqdadbadjuber/anti-slop -s antislop antislop-ui antislop-human antislop-layoutmobile antislop-code antislop-copywriting -a antigravity --copy -y
npx --yes skills add supabase/agent-skills -s supabase supabase-postgres-best-practices -a antigravity --copy -y
```

Session reload instructions and the Anti-Slop pointer block (`<!-- antislop:start --> ... <!-- antislop:end -->`) are configured in `AGENTS.md`.

## 2. Playwright Test Framework

Playwright is installed as a project dev dependency (`@playwright/test`) for automated browser smoke testing (`tests/e2e/smoke.spec.js`), not as an agent skill. Run:

```bash
npx playwright install chromium
npm run test:e2e
```

## 3. Repository & Remote Guardrails

- Follow the branch flow: `main` (stable baseline) -> `develop` (integration) -> `feature/<member>-<module>` (created from `develop`). Target feature Pull Requests at `develop`, and open a reviewed Pull Request from `develop` to `main` after integration QA.
- Only repository owner Fikri manages GitHub collaborator invitations (`Settings > Collaborators`).
- Never apply remote Supabase migrations, modify remote Supabase RLS/settings, or deploy to Vercel without explicit owner approval.
