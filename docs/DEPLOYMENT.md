# Deployment Preparation: Vercel & Environment Variables

Deployment to Vercel has **not been executed** during foundation setup because remote Vercel and Supabase credentials are intentionally excluded from the repository.

## 1. Frontend Build Configuration

`vercel.json` is preconfigured at the repository root:
- Framework: `vite`
- Build command: `npm run build`
- Output directory: `dist`
- SPA rewrite: routes non-asset/non-data paths to `/index.html` while preserving `/assets/*` and `/data/*` static files
- Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`

## 2. Environment Variables

Configure these variables in the Vercel project dashboard before deploying:

| Variable | Required for Local-Only Mode? | Required for Supabase Mode? | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | No (leave blank) | Yes | Public project URL (`https://<ref>.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | No (leave blank) | Yes | Public publishable key (`sb_publishable_...`). Never use `service_role` or secret keys. |

Rules:
- Never commit `.env` or `.env.local` files (protected by `.gitignore`).
- Never place `SUPABASE_SERVICE_ROLE_KEY`, database passwords, or management tokens in `VITE_*` variables or frontend code.
- Without Supabase environment variables (or when Supabase snapshots are from an older schema version before `2026-11-27-prod`), the deployed static Vite bundle automatically serves validated datasets under `public/data/`.
