---
paths:
  - "src/lib/supabaseClient.ts"
  - "src/lib/cloudProjects*.ts"
  - "supabase/**"
---

# Cloud persistence (`src/lib/supabaseClient.ts`, `src/lib/cloudProjects.ts`)

Named saves (`namedProjects` in `App.tsx`) can optionally live in a
Supabase-backed cloud account instead of (or alongside) the existing
per-browser `localStorage` named-projects store — autosave remains
local-only, untouched. `supabaseClient.ts`'s `supabase` export is
`null` whenever `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` aren't set
(no `.env` configured, e.g. most dev/CI environments) — every function in
`cloudProjects.ts` checks for this and degrades to a no-op/empty-result
rather than throwing, and `Sidebar.tsx` hides all cloud UI (sign-in link,
Local/Cloud toggle, cloud badges) entirely via a `cloudConfigured` prop
when unconfigured, so the app is indistinguishable from before this
feature existed until a Supabase project is actually wired up. Auth is
email-magic-link only (`supabase.auth.signInWithOtp`) — no
password/OAuth. `App.tsx` merges `localProjects` and `cloudProjects` into
one `namedProjects` list (each entry tagged `source: "local" | "cloud"`),
and every load/delete call now threads that `source` through so it hits
the right backend. Saving overwrites-by-name in both stores (a Postgres
`unique (user_id, name)` constraint plus `upsert` on the cloud side,
matching the local store's existing overwrite-by-name `Record<name, ...>`
shape) — there's no multi-device conflict resolution beyond that. See
`docs/superpowers/specs/2026-08-11-cloud-persistence-design.md` for the
full design and the SQL migration under `supabase/migrations/`.
