---
paths:
  - "wrangler.toml"
  - ".github/workflows/**"
  - "public/hb.wasm"
---

# Deployment

Live at <https://harf.hash.immo>, served by Cloudflare Workers static assets.

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs lint, the
unit suite, and `npm run build`, then publishes with Wrangler. The unit suite
gates the deploy; the Playwright e2e suite does not, since it needs browsers
installed — run it locally with `npm run e2e` before shipping anything that
touches canvas interaction. Deploying by hand is `npm run build && npx wrangler
deploy`, which needs `npx wrangler login` once per machine.

Two repository secrets drive it: `CLOUDFLARE_API_TOKEN` (needs Workers Scripts
edit, plus Workers Routes edit on the `hash.immo` zone — without the zone
permission the Worker publishes but the custom domain is never attached) and
`CLOUDFLARE_ACCOUNT_ID`.

**Both must be present, and the error message does not tell you which one is
missing.** From 2026-08-19 to 2026-08-21 only the token was set, and every run
failed with wrangler's `it's necessary to set a CLOUDFLARE_API_TOKEN` — naming
the secret that *was* configured. Adding the account ID and re-pasting the
token together fixed it, so it is not established which of the two the message
was really about; treat it as "check both" rather than as evidence about the
token. A green run's own log is the thing to read, and the line worth finding
is `Deployed harf triggers` followed by `harf.hash.immo (custom domain)` —
that, not the checkmark, is what says the zone permission was sufficient and
the domain is attached.

`wrangler.toml` holds the whole configuration, with nothing set dashboard-only:
`dist` as the asset directory, `not_found_handling = "single-page-application"`
for the SPA fallback, and a `[[routes]]` block declaring `harf.hash.immo` as a
custom domain so any deploy recreates it.

Fonts and `hb.wasm` ship as static assets out of `public/`, so a deploy that
serves `hb.wasm` with the wrong content type breaks shaping outright — it must
come back as `application/wasm`. Worth checking directly after any change to
how assets are built or served.

Supabase is not configured in production. `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are absent, so `supabaseClient` is `null`, cloud
project save/load stays hidden, and the dependency tree-shakes out of the
bundle. Enabling it later is environment variables plus a redeploy, with no
code change — but note those are `VITE_` variables, baked into the public
bundle, so the anon key becomes publicly readable and row-level security has to
be correct before that switch is flipped.
