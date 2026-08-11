# Cloud Persistence — Design

Date: 2026-08-11
Status: Approved, ready for implementation planning

This is sub-project 3 of 3 in the larger "Fiddlesticks-inspired features"
initiative (sub-project 1, image-trace Shape Warp, and sub-project 2,
Template Wizard, are already merged into `main`). This sub-project has no
dependency on the other two.

## Summary

Add an optional cloud backup for the existing "named saves" feature. A
signed-in user can save a named project to the cloud instead of (or in
addition to) the browser's `localStorage`, and load/delete it from any
browser once signed in again. This is the smallest version of Fiddlesticks'
cloud-persistence concept — private per-user backup of named projects, not
full sync, sharing, or collaboration.

The app currently has no backend at all (a pure static Vite/React
frontend). This sub-project introduces the app's first backend dependency:
Supabase (managed Postgres + auth), chosen over a custom API for zero
server code to write or host, and over Firebase for its relational/SQL
model and Row-Level-Security policies mapping cleanly onto "each user sees
only their own rows."

## Non-goals

- No OAuth or password auth — email magic link only.
- No sharing/collaboration/public read-only links.
- No full sync — autosave and glyph rigs (`STORAGE_KEY`, `GLYPH_RIGS_KEY`)
  stay local-only exactly as today; only the named-projects feature gains a
  cloud option.
- No offline queueing or multi-device conflict resolution beyond simple
  overwrite-by-name (same semantics the existing local save already has).
- No realtime multi-device updates — the cloud project list refreshes only
  after an explicit save/delete/sign-in in this session, not automatically
  when another device/tab changes it.
- No bulk migration tool for moving existing local named projects to the
  cloud — a user re-saves individually if they want a local project
  mirrored to cloud. Cheap follow-up later if asked for.

## Prerequisites (manual, one-time, done by the user)

1. Create a free Supabase project at supabase.com.
2. In the Supabase SQL editor, run the migration in "Data model" below.
3. Copy the project's URL and anon (public) public API key into a local
   `.env` file (git-ignored) as `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`. A `.env.example` with just the two variable
   names (no values) is committed to the repo.
4. In Supabase Auth settings, enable "Email" as a sign-in provider (magic
   link is Supabase's default email flow) and add the app's local/deployed
   URL to the allowed redirect URLs list.

The anon key is safe to ship to the browser bundle — Supabase's
Row-Level-Security policies, not key secrecy, are what restrict access to
each user's own rows. No secret/service-role key is ever used client-side.

## Data model

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  payload jsonb not null,
  saved_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table projects enable row level security;

create policy "own projects" on projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

`payload` stores exactly what `buildLayoutPayload()` (`App.tsx`) already
produces for local named saves — no new serialization format. The
`unique (user_id, name)` constraint plus a Supabase `upsert` call gives
"Save As" the same overwrite-by-name behavior the local feature already
has.

## New pure/library code

- **`src/lib/supabaseClient.ts`** — a singleton `createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)`, exported once and reused everywhere else that needs it.

- **`src/lib/cloudProjects.ts`** — thin wrapper around the Supabase client,
  mirroring the shapes of the existing local-project functions in
  `App.tsx` so wiring stays symmetric:
  - `signInWithEmail(email: string): Promise<{ error: string | null }>` —
    calls `supabase.auth.signInWithOtp({ email })`.
  - `signOut(): Promise<void>`.
  - `getSession(): Promise<Session | null>` and re-exporting
    `supabase.auth.onAuthStateChange` for `App.tsx` to subscribe to.
  - `saveCloudProject(name: string, payload: unknown): Promise<{ error: string | null }>` — upserts by `(user_id, name)` (user_id comes from the
    current session, set server-side by RLS default — not passed by the
    client).
  - `listCloudProjects(): Promise<{ name: string; savedAt: number }[]>` —
    selects `name, saved_at` for the current user, sorted by `saved_at`
    descending, shaped identically to the existing `NamedProjectMeta`.
  - `loadCloudProject(name: string): Promise<{ payload: unknown } | null>`.
  - `deleteCloudProject(name: string): Promise<{ error: string | null }>`.

  Every function returns an `error` string (never throws) so call sites in
  `App.tsx` can handle failures uniformly without try/catch scattered
  around.

## Wiring

- **`App.tsx`:**
  - New `session` state, set once from `getSession()` at mount and kept in
    sync via `onAuthStateChange`.
  - `NamedProjectMeta` gains `source: "local" | "cloud"`. The existing
    `namedProjects` list becomes the merged, sorted union of local entries
    (from `localStorage`, unchanged) and cloud entries (from
    `listCloudProjects()`, fetched on sign-in and refreshed after any
    cloud save/delete).
  - New `saveDestination: "local" | "cloud"` state (defaults to
    `"local"`), toggled from the sidebar.
  - `saveNamedProject(name)` branches on `saveDestination`: `"local"` keeps
    today's exact `localStorage` path; `"cloud"` calls
    `saveCloudProject(name, buildLayoutPayload())`, then re-fetches the
    cloud list.
  - `loadNamedProject(name, source)` and `deleteNamedProject(name, source)`
    gain a `source` parameter, routing to the matching backend.
  - New `signIn(email)`/`signOutUser()` handlers wired to
    `cloudProjects.ts`.

- **`Sidebar.tsx`:**
  - A small sign-in entry point above/beside the "Named saves" section
    header: signed-out shows a "Sign in" link opening an inline
    email-input + "Send magic link" form; on success, inline "Check your
    email for a sign-in link" text. Signed-in shows the user's email + a
    "Sign out" link.
  - A `Local | Cloud` pill toggle (styled like the existing
    `sidebarPillButton`) next to the "Save As" input, disabled (with a
    "Sign in to save to cloud" tooltip) while signed out.
  - Each row in the named-projects list gets a small "Local"/"Cloud" badge
    next to its name, read from `source`. Load/Delete buttons pass
    `source` through to the `App.tsx` handlers.

## Data flow

```
Sign in:
  email entered → signInWithEmail(email) → Supabase sends magic-link email
  → user clicks link → Supabase redirects back with a session
  → onAuthStateChange fires → App.tsx sets `session`
  → listCloudProjects() fetched, merged into `namedProjects`

Save to cloud:
  user picks "Cloud" toggle, types a name, clicks Save As
  → saveCloudProject(name, buildLayoutPayload())
  → on success, re-fetch listCloudProjects(), merge into namedProjects

Load/delete:
  click Load/Delete on a row → routes to local or cloud handler by `source`
  → cloud path calls loadCloudProject/deleteCloudProject
  → same downstream apply/refresh logic the local path already has
```

## Error handling

- Magic-link send failure (bad email, network error, provider rate limit):
  inline error text under the email input, not a blocking `alert` —
  mirrors `ImageTraceDialog`'s inline-failure convention.
- Cloud save/load/delete network failure: a blocking
  `alert("Couldn't save to cloud — check your connection and try again.")`
  (wording adjusted per action). Unlike the existing local-save
  quota-exceeded path (which fails silently, best-effort), a failed cloud
  write is a real data-loss risk worth surfacing.
- A stale-UI race where a cloud action fires while signed out is a no-op —
  the toggle is disabled whenever `session` is null, so this shouldn't be
  reachable in normal use.

## Testing

- **`src/lib/cloudProjects.test.ts`** — the real `@supabase/supabase-js`
  client constructed against a mocked `fetch`/mocked Supabase client
  object. Network auth is a genuine external-service boundary (unlike
  `harfbuzzjs`/`imagetracerjs`, which are deterministic in-process
  libraries this project prefers to test against real behavior), so
  mocking here is appropriate, not a shortcut. Covers: save upserts by
  name (existing name is overwritten, not duplicated), list returns
  entries sorted by `saved_at` descending in the `NamedProjectMeta` shape,
  delete removes the right row, and a failed request resolves to an
  `error` string rather than throwing.
- Sign-in UI, the toggle, and the merged-list rendering are not
  unit-tested — consistent with this codebase's convention of leaving
  modal/interactive UI components untested (`ConfirmDialog.tsx`,
  `ImageTraceDialog.tsx`, `TemplateWizardDialog.tsx`).
- **Manual verification** (documented as a plan step, since there is no
  live Supabase project available in this environment to test against):
  sign in with a real email, confirm the magic-link round-trip lands back
  in the app signed in, save/load/delete a cloud project, confirm local
  named-projects still work completely unaffected.
