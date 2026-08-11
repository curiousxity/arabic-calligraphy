# Cloud Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional per-user cloud backup for the existing "named saves" feature, backed by Supabase (Postgres + email-magic-link auth), with local named saves and every other existing persistence path (autosave, glyph rigs) completely untouched.

**Architecture:** A new `src/lib/supabaseClient.ts` builds a singleton Supabase client from Vite env vars (or `null` if unconfigured — the whole feature must degrade gracefully when no Supabase project is set up, since this repo has no backend today and most dev environments won't have credentials). A new `src/lib/cloudProjects.ts` wraps auth + CRUD calls behind promise-returning functions shaped to match the app's existing local-save functions. `App.tsx` merges local and cloud project lists into one `namedProjects` array tagged by `source`, adds session/auth state, and threads a `source` parameter through the existing save/load/delete handlers. `Sidebar.tsx` gains a sign-in mini-form, a Local/Cloud save-destination toggle, and per-row source badges.

**Tech Stack:** `@supabase/supabase-js` (new dependency), existing React 19 + TypeScript + Vite stack, Vitest for `cloudProjects.ts` unit tests (network layer mocked).

## Global Constraints

- No OAuth or password auth — email magic link only (spec's Auth Flow section).
- No sharing/collaboration/public links.
- Autosave (`STORAGE_KEY`) and glyph rigs (`GLYPH_RIGS_KEY`) stay local-only, completely unmodified — only the named-projects feature gains a cloud option.
- No offline queueing or conflict resolution beyond simple overwrite-by-name (`unique (user_id, name)` + Supabase `upsert`).
- No realtime multi-device updates — cloud list refreshes only after an explicit save/delete/sign-in in this session.
- No bulk migration tool for moving local named projects to the cloud.
- Every `cloudProjects.ts` function returns `{ error: string | null }` (or `null`/`[]` for reads) rather than throwing, so `App.tsx` call sites never need try/catch.
- The whole cloud feature must degrade to "invisible, app works exactly as before" when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are not set (no live Supabase project in most dev/CI environments).
- `payload` sent to Supabase is exactly what `buildLayoutPayload()` in `App.tsx` already produces — no new serialization format.

---

### Task 1: Supabase dependency, env plumbing, client singleton, DB migration

**Files:**
- Modify: `package.json` (add `@supabase/supabase-js` dependency)
- Create: `src/lib/supabaseClient.ts`
- Create: `src/vite-env.d.ts`
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `supabase/migrations/2026-08-11-projects-table.sql`

**Interfaces:**
- Produces: `supabase: import("@supabase/supabase-js").SupabaseClient | null` exported from `src/lib/supabaseClient.ts` — `null` whenever either env var is missing/empty. All later tasks import this and must handle the `null` case.

- [ ] **Step 1: Install the dependency**

Run: `npm install @supabase/supabase-js@^2`

- [ ] **Step 2: Add env var typing**

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 3: Create the client singleton**

Create `src/lib/supabaseClient.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * `null` whenever Supabase env vars aren't configured — most dev/CI
 * environments won't have a live Supabase project, and the whole cloud
 * feature must degrade to "invisible, app works exactly as before" in
 * that case rather than crashing at module load. See cloudProjects.ts
 * and Sidebar's `cloudConfigured` gating for how callers handle `null`.
 */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
```

- [ ] **Step 4: Add `.env.example` and update `.gitignore`**

Create `.env.example`:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Add to `.gitignore` (after the existing `*.local` line):

```
.env
```

- [ ] **Step 5: Write the DB migration file**

Create `supabase/migrations/2026-08-11-projects-table.sql` (run manually by the user in the Supabase SQL editor — this repo has no Supabase CLI/migration runner set up, so this file is documentation-as-SQL, not executed by any build step):

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

- [ ] **Step 6: Verify the project still builds and typechecks**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: both succeed with no errors. `supabase` will be `null` at runtime (no env vars set in this environment) — that's correct, not a bug, at this stage.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/supabaseClient.ts src/vite-env.d.ts .env.example .gitignore supabase/migrations/2026-08-11-projects-table.sql
git commit -m "Add Supabase dependency, client singleton, and DB migration"
```

---

### Task 2: `cloudProjects.ts` — auth + CRUD wrapper, fully unit-tested

**Files:**
- Create: `src/lib/cloudProjects.ts`
- Test: `src/lib/cloudProjects.test.ts`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabaseClient.ts` (Task 1) — `SupabaseClient | null`.
- Produces (all consumed by `App.tsx` in Task 3):
  ```ts
  export type CloudProjectMeta = { name: string; savedAt: number };

  export function isCloudConfigured(): boolean;
  export async function signInWithEmail(email: string): Promise<{ error: string | null }>;
  export async function signOut(): Promise<void>;
  export async function getSession(): Promise<import("@supabase/supabase-js").Session | null>;
  export function onAuthStateChange(
    callback: (session: import("@supabase/supabase-js").Session | null) => void
  ): () => void; // returns an unsubscribe function
  export async function saveCloudProject(name: string, payload: unknown): Promise<{ error: string | null }>;
  export async function listCloudProjects(): Promise<CloudProjectMeta[]>;
  export async function loadCloudProject(name: string): Promise<{ payload: unknown } | null>;
  export async function deleteCloudProject(name: string): Promise<{ error: string | null }>;
  ```

- [ ] **Step 1: Write the implementation**

Create `src/lib/cloudProjects.ts`:

```ts
import { supabase } from "./supabaseClient";
import type { Session } from "@supabase/supabase-js";

export type CloudProjectMeta = { name: string; savedAt: number };

const NOT_CONFIGURED = "Cloud persistence is not configured.";
const TABLE = "projects";

export function isCloudConfigured(): boolean {
  return supabase !== null;
}

export async function signInWithEmail(email: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.auth.signInWithOtp({ email });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthStateChange(callback: (session: Session | null) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}

export async function saveCloudProject(
  name: string,
  payload: unknown
): Promise<{ error: string | null }> {
  if (!supabase) return { error: NOT_CONFIGURED };
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return { error: "Not signed in." };
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      { user_id: userId, name, payload, saved_at: new Date().toISOString() },
      { onConflict: "user_id,name" }
    );
  return { error: error?.message ?? null };
}

export async function listCloudProjects(): Promise<CloudProjectMeta[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("name, saved_at")
    .order("saved_at", { ascending: false });
  if (error || !data) return [];
  return data.map((row) => ({
    name: row.name as string,
    savedAt: new Date(row.saved_at as string).getTime(),
  }));
}

export async function loadCloudProject(name: string): Promise<{ payload: unknown } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select("payload")
    .eq("name", name)
    .single();
  if (error || !data) return null;
  return { payload: data.payload };
}

export async function deleteCloudProject(name: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.from(TABLE).delete().eq("name", name);
  return { error: error?.message ?? null };
}
```

- [ ] **Step 2: Write the test file**

Create `src/lib/cloudProjects.test.ts`. This mocks `src/lib/supabaseClient.ts`'s `supabase` export with a fake chainable query-builder object — Supabase's own network layer is a genuine external-service boundary (unlike `harfbuzzjs`/`imagetracerjs`, which are deterministic in-process libraries this project prefers to test for real), so mocking it here is the correct call, not a shortcut.

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockUpsert = vi.fn();
const mockOrder = vi.fn();
const mockSingle = vi.fn();
const mockDeleteEq = vi.fn();
const mockGetUser = vi.fn();
const mockSignInWithOtp = vi.fn();
const mockSignOut = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock("./supabaseClient", () => ({
  get supabase() {
    return {
      auth: {
        signInWithOtp: mockSignInWithOtp,
        signOut: mockSignOut,
        getSession: mockGetSession,
        getUser: mockGetUser,
        onAuthStateChange: mockOnAuthStateChange,
      },
      from: (table: string) => ({
        select: (cols: string) => {
          if (cols === "name, saved_at") {
            return { order: mockOrder };
          }
          // payload lookup: select("payload").eq(name).single()
          return { eq: () => ({ single: mockSingle }) };
        },
        upsert: mockUpsert,
        delete: () => ({ eq: mockDeleteEq }),
      }),
    };
  },
}));

import {
  signInWithEmail,
  signOut,
  getSession,
  onAuthStateChange,
  saveCloudProject,
  listCloudProjects,
  loadCloudProject,
  deleteCloudProject,
  isCloudConfigured,
} from "./cloudProjects";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cloudProjects", () => {
  it("reports configured when the mocked client is present", () => {
    expect(isCloudConfigured()).toBe(true);
  });

  it("signInWithEmail forwards to signInWithOtp and surfaces no error on success", async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    const result = await signInWithEmail("user@example.com");
    expect(mockSignInWithOtp).toHaveBeenCalledWith({ email: "user@example.com" });
    expect(result.error).toBeNull();
  });

  it("signInWithEmail surfaces the provider's error message", async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { message: "rate limited" } });
    const result = await signInWithEmail("user@example.com");
    expect(result.error).toBe("rate limited");
  });

  it("signOut calls the client's signOut", async () => {
    mockSignOut.mockResolvedValue({ error: null });
    await signOut();
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("getSession returns the current session", async () => {
    const fakeSession = { access_token: "t" };
    mockGetSession.mockResolvedValue({ data: { session: fakeSession } });
    const session = await getSession();
    expect(session).toBe(fakeSession);
  });

  it("onAuthStateChange wires the callback and returns an unsubscribe function", () => {
    const unsubscribe = vi.fn();
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
    const callback = vi.fn();
    const stop = onAuthStateChange(callback);
    expect(mockOnAuthStateChange).toHaveBeenCalled();
    const registeredHandler = mockOnAuthStateChange.mock.calls[0][0];
    const fakeSession = { access_token: "t" };
    registeredHandler("SIGNED_IN", fakeSession);
    expect(callback).toHaveBeenCalledWith(fakeSession);
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("saveCloudProject upserts with the signed-in user's id, name, and payload", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockUpsert.mockResolvedValue({ error: null });
    const result = await saveCloudProject("My Design", { blocks: [] });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", name: "My Design", payload: { blocks: [] } }),
      { onConflict: "user_id,name" }
    );
    expect(result.error).toBeNull();
  });

  it("saveCloudProject errors when there is no signed-in user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await saveCloudProject("My Design", { blocks: [] });
    expect(result.error).toBe("Not signed in.");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("listCloudProjects returns entries sorted by saved_at descending, shaped as CloudProjectMeta", async () => {
    mockOrder.mockResolvedValue({
      data: [
        { name: "Newer", saved_at: "2026-08-11T12:00:00.000Z" },
        { name: "Older", saved_at: "2026-08-10T12:00:00.000Z" },
      ],
      error: null,
    });
    const result = await listCloudProjects();
    expect(mockOrder).toHaveBeenCalledWith("saved_at", { ascending: false });
    expect(result).toEqual([
      { name: "Newer", savedAt: new Date("2026-08-11T12:00:00.000Z").getTime() },
      { name: "Older", savedAt: new Date("2026-08-10T12:00:00.000Z").getTime() },
    ]);
  });

  it("listCloudProjects returns an empty array on error", async () => {
    mockOrder.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await listCloudProjects();
    expect(result).toEqual([]);
  });

  it("loadCloudProject returns the stored payload", async () => {
    mockSingle.mockResolvedValue({ data: { payload: { blocks: ["a"] } }, error: null });
    const result = await loadCloudProject("My Design");
    expect(result).toEqual({ payload: { blocks: ["a"] } });
  });

  it("loadCloudProject returns null when the row isn't found", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "not found" } });
    const result = await loadCloudProject("Missing");
    expect(result).toBeNull();
  });

  it("deleteCloudProject deletes the row matching the given name", async () => {
    mockDeleteEq.mockResolvedValue({ error: null });
    const result = await deleteCloudProject("My Design");
    expect(mockDeleteEq).toHaveBeenCalledWith("name", "My Design");
    expect(result.error).toBeNull();
  });

  it("deleteCloudProject surfaces the provider's error message", async () => {
    mockDeleteEq.mockResolvedValue({ error: { message: "denied" } });
    const result = await deleteCloudProject("My Design");
    expect(result.error).toBe("denied");
  });
});
```

- [ ] **Step 3: Run the test file**

Run: `npx vitest run src/lib/cloudProjects.test.ts`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cloudProjects.ts src/lib/cloudProjects.test.ts
git commit -m "Add cloudProjects.ts auth+CRUD wrapper with unit tests"
```

---

### Task 3: Wire session, save-destination, and merged project list into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: everything exported from `src/lib/cloudProjects.ts` (Task 2).
- Produces (consumed by `Sidebar.tsx` in Task 4):
  ```ts
  export type NamedProjectMeta = { name: string; savedAt: number; source: "local" | "cloud" };
  // App passes to Sidebar:
  cloudConfigured: boolean;
  session: import("@supabase/supabase-js").Session | null;
  onSignIn: (email: string) => Promise<{ error: string | null }>;
  onSignOut: () => void;
  saveDestination: "local" | "cloud";
  onChangeSaveDestination: (dest: "local" | "cloud") => void;
  namedProjects: NamedProjectMeta[]; // now carries `source`
  onSaveNamedProject: (name: string) => void;         // unchanged signature, routes internally
  onLoadNamedProject: (name: string, source: "local" | "cloud") => void;
  onDeleteNamedProject: (name: string, source: "local" | "cloud") => void;
  ```

- [ ] **Step 1: Extend `NamedProjectMeta` and add new imports**

In `src/App.tsx`, find:

```ts
export type NamedProjectMeta = { name: string; savedAt: number };
```

Replace with:

```ts
export type NamedProjectMeta = { name: string; savedAt: number; source: "local" | "cloud" };
```

Near the top of the file, alongside the other `lib` imports, add:

```ts
import type { Session } from "@supabase/supabase-js";
import {
  isCloudConfigured,
  signInWithEmail,
  signOut as cloudSignOut,
  getSession,
  onAuthStateChange,
  saveCloudProject,
  listCloudProjects,
  loadCloudProject,
  deleteCloudProject,
} from "./lib/cloudProjects";
```

- [ ] **Step 2: Rename the `namedProjects` state to `localProjects` and tag it `source: "local"`**

Find (the `namedProjects` `useState` initializer):

```ts
  const [namedProjects, setNamedProjects] = useState<NamedProjectMeta[]>(() => {
    if (!isBrowser) return [];
    try {
      const raw = localStorage.getItem(NAMED_PROJECTS_KEY);
      if (!raw) return [];
      const store = JSON.parse(raw) as NamedProjectsStore;
      return Object.entries(store)
        .map(([name, entry]) => ({ name, savedAt: entry.savedAt }))
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      return [];
    }
  });
```

Replace with:

```ts
  const [localProjects, setLocalProjects] = useState<NamedProjectMeta[]>(() => {
    if (!isBrowser) return [];
    try {
      const raw = localStorage.getItem(NAMED_PROJECTS_KEY);
      if (!raw) return [];
      const store = JSON.parse(raw) as NamedProjectsStore;
      return Object.entries(store)
        .map(([name, entry]) => ({ name, savedAt: entry.savedAt, source: "local" as const }))
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      return [];
    }
  });
```

Then find the existing `refreshNamedProjectsList` function (near `readNamedProjectsStore`, around where `NAMED_PROJECTS_KEY` is read) and change every `setNamedProjects(...)` call inside it to `setLocalProjects(...)` — same transform it already does, only the setter name changes. Leave `readNamedProjectsStore` itself untouched.

- [ ] **Step 3: Add session, cloud-projects, and save-destination state, and the merged `namedProjects` list**

Immediately after the `localProjects` `useState` block from Step 2, add:

```ts
  const [session, setSession] = useState<Session | null>(null);
  const [cloudProjects, setCloudProjects] = useState<NamedProjectMeta[]>([]);
  const [saveDestination, setSaveDestination] = useState<"local" | "cloud">("local");
  const cloudConfigured = isCloudConfigured();

  const refreshCloudProjects = useCallback(async () => {
    if (!session) {
      setCloudProjects([]);
      return;
    }
    const list = await listCloudProjects();
    setCloudProjects(list.map((p) => ({ ...p, source: "cloud" as const })));
  }, [session]);

  useEffect(() => {
    if (!cloudConfigured) return;
    let cancelled = false;
    getSession().then((s) => {
      if (!cancelled) setSession(s);
    });
    const unsubscribe = onAuthStateChange((s) => {
      setSession(s);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cloudConfigured]);

  useEffect(() => {
    refreshCloudProjects();
  }, [refreshCloudProjects]);

  const namedProjects = useMemo<NamedProjectMeta[]>(
    () => [...localProjects, ...cloudProjects].sort((a, b) => b.savedAt - a.savedAt),
    [localProjects, cloudProjects]
  );
```

Note: `useCallback`/`useEffect`/`useMemo` are already imported in `App.tsx` (used extensively elsewhere) — no new hook imports needed. `namedProjects` is now a derived value, not a `useState` — any other in-file reference to `setNamedProjects` besides the ones already handled in Step 2 is a bug in this task's edits; search for `setNamedProjects` afterward and confirm zero remaining references.

- [ ] **Step 4: Route save/load/delete by destination and source**

Find `saveNamedProject`:

```ts
  const saveNamedProject = (name: string) => {
    const trimmed = name.trim();
    if (!isBrowser || !trimmed) return;
    try {
      const store = readNamedProjectsStore();
      store[trimmed] = { savedAt: Date.now(), payload: buildLayoutPayload() };
      localStorage.setItem(NAMED_PROJECTS_KEY, JSON.stringify(store));
      refreshNamedProjectsList(store);
    } catch {
      // Ignore quota-exceeded / privacy-mode storage errors — best-effort.
    }
  };
```

Replace with:

```ts
  const saveNamedProjectLocal = (trimmed: string) => {
    if (!isBrowser) return;
    try {
      const store = readNamedProjectsStore();
      store[trimmed] = { savedAt: Date.now(), payload: buildLayoutPayload() };
      localStorage.setItem(NAMED_PROJECTS_KEY, JSON.stringify(store));
      refreshNamedProjectsList(store);
    } catch {
      // Ignore quota-exceeded / privacy-mode storage errors — best-effort.
    }
  };

  const saveNamedProjectCloud = async (trimmed: string) => {
    const { error } = await saveCloudProject(trimmed, buildLayoutPayload());
    if (error) {
      alert("Couldn't save to cloud — check your connection and try again.");
      return;
    }
    await refreshCloudProjects();
  };

  const saveNamedProject = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (saveDestination === "cloud") {
      saveNamedProjectCloud(trimmed);
    } else {
      saveNamedProjectLocal(trimmed);
    }
  };
```

Find `loadNamedProject`:

```ts
  const loadNamedProject = (name: string) => {
    const store = readNamedProjectsStore();
    const entry = store[name];
    if (!entry) return;
    applyStoredPayload(JSON.stringify(entry.payload));
  };
```

Replace with:

```ts
  const loadNamedProject = (name: string, source: "local" | "cloud") => {
    if (source === "local") {
      const store = readNamedProjectsStore();
      const entry = store[name];
      if (!entry) return;
      applyStoredPayload(JSON.stringify(entry.payload));
      return;
    }
    loadCloudProject(name).then((result) => {
      if (!result) {
        alert("Couldn't load that cloud project — check your connection and try again.");
        return;
      }
      applyParsedLayoutPayload(result.payload);
    });
  };
```

Find `deleteNamedProject`:

```ts
  const deleteNamedProject = (name: string) => {
    const store = readNamedProjectsStore();
    delete store[name];
    try {
      localStorage.setItem(NAMED_PROJECTS_KEY, JSON.stringify(store));
    } catch {
      // best-effort
    }
    refreshNamedProjectsList(store);
  };
```

Replace with:

```ts
  const deleteNamedProject = (name: string, source: "local" | "cloud") => {
    if (source === "local") {
      const store = readNamedProjectsStore();
      delete store[name];
      try {
        localStorage.setItem(NAMED_PROJECTS_KEY, JSON.stringify(store));
      } catch {
        // best-effort
      }
      refreshNamedProjectsList(store);
      return;
    }
    deleteCloudProject(name).then(({ error }) => {
      if (error) {
        alert("Couldn't delete that cloud project — check your connection and try again.");
        return;
      }
      refreshCloudProjects();
    });
  };
```

Find `requestDeleteNamedProject` (calls `deleteNamedProject(name)`):

```ts
  const requestDeleteNamedProject = (name: string) => {
    setConfirmRequest({
      title: `Delete "${name}"?`,
      message:
        "This removes the saved project from this browser for good — unlike canvas edits, it isn't covered by Ctrl+Z.",
      confirmLabel: "Delete project",
      onConfirm: () => {
        setConfirmRequest(null);
        deleteNamedProject(name);
      },
    });
  };
```

Replace with (add a `source` parameter, adjust the confirm-dialog message to be source-neutral, and thread `source` through to `deleteNamedProject`):

```ts
  const requestDeleteNamedProject = (name: string, source: "local" | "cloud") => {
    setConfirmRequest({
      title: `Delete "${name}"?`,
      message:
        source === "local"
          ? "This removes the saved project from this browser for good — unlike canvas edits, it isn't covered by Ctrl+Z."
          : "This removes the saved project from your cloud account for good — unlike canvas edits, it isn't covered by Ctrl+Z.",
      confirmLabel: "Delete project",
      onConfirm: () => {
        setConfirmRequest(null);
        deleteNamedProject(name, source);
      },
    });
  };
```

Find every call site of `requestDeleteNamedProject(...)` outside its own definition (search `requestDeleteNamedProject(` in `App.tsx`) and update each to pass `source` through from wherever it's called (this is wired from `Sidebar.tsx` in Task 4 — no other in-file call sites are expected, but confirm via search before moving on).

- [ ] **Step 5: Add sign-in/sign-out handlers**

Near `saveNamedProject`/`loadNamedProject`, add:

```ts
  const handleSignIn = (email: string) => signInWithEmail(email);

  const handleSignOut = () => {
    cloudSignOut();
    setCloudProjects([]);
  };
```

- [ ] **Step 6: Wire the new props into `<Sidebar>`**

Find the `<Sidebar ... />` JSX in `App.tsx`'s render. Add these props (placed near the existing `namedProjects`/`onSaveNamedProject`/`onLoadNamedProject`/`onDeleteNamedProject` props):

```tsx
        cloudConfigured={cloudConfigured}
        session={session}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        saveDestination={saveDestination}
        onChangeSaveDestination={setSaveDestination}
```

And update the existing `onDeleteNamedProject` prop, which currently points at `requestDeleteNamedProject` — no change needed to the prop wiring itself (`Sidebar.tsx` in Task 4 will call it with the extra `source` argument).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: errors only in `Sidebar.tsx` (not yet updated — that's Task 4). Confirm every error is confined to `src/components/Sidebar.tsx` and its prop mismatches; anything else is a mistake in this task's edits.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "Wire session, cloud project list, and save-destination routing into App.tsx"
```

---

### Task 4: Sign-in UI, save-destination toggle, and source badges in `Sidebar.tsx`

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `NamedProjectMeta` (now with `source`), and the new props from Task 3 (`cloudConfigured`, `session`, `onSignIn`, `onSignOut`, `saveDestination`, `onChangeSaveDestination`).
- Produces: `onLoadNamedProject`/`onDeleteNamedProject` now called with `(name, source)` instead of `(name)`.

- [ ] **Step 1: Extend `SidebarProps`**

In `src/components/Sidebar.tsx`, find:

```ts
  onSaveLayout: () => void;
  onLoadLayout: () => void;
  onDownloadLayout: () => void;
  onUploadLayout: () => void;
  namedProjects?: NamedProjectMeta[];
  onSaveNamedProject?: (name: string) => void;
  onLoadNamedProject?: (name: string) => void;
  onDeleteNamedProject?: (name: string) => void;
```

Replace with:

```ts
  onSaveLayout: () => void;
  onLoadLayout: () => void;
  onDownloadLayout: () => void;
  onUploadLayout: () => void;
  namedProjects?: NamedProjectMeta[];
  onSaveNamedProject?: (name: string) => void;
  onLoadNamedProject?: (name: string, source: "local" | "cloud") => void;
  onDeleteNamedProject?: (name: string, source: "local" | "cloud") => void;

  cloudConfigured?: boolean;
  session?: import("@supabase/supabase-js").Session | null;
  onSignIn?: (email: string) => Promise<{ error: string | null }>;
  onSignOut?: () => void;
  saveDestination?: "local" | "cloud";
  onChangeSaveDestination?: (dest: "local" | "cloud") => void;
```

- [ ] **Step 2: Destructure the new props**

Find the function-parameter destructuring block (around where `namedProjects = [], onSaveNamedProject, onLoadNamedProject,` appear — same block noted in exploration). Add the new props to that destructuring list:

```ts
  namedProjects = [],
  onSaveNamedProject,
  onLoadNamedProject,
  onDeleteNamedProject,
  cloudConfigured = false,
  session = null,
  onSignIn,
  onSignOut,
  saveDestination = "local",
  onChangeSaveDestination,
```

(`onDeleteNamedProject` should already be present in this list — confirm it is; if it's destructured elsewhere in the component instead, add the new props there.)

- [ ] **Step 3: Add local state for the sign-in mini-form**

Near the top of the component body, alongside other `useState` calls (e.g. near `namedProjectInput`), add:

```ts
  const [signInEmail, setSignInEmail] = useState("");
  const [signInStatus, setSignInStatus] = useState<
    { kind: "idle" } | { kind: "sent" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [showSignInForm, setShowSignInForm] = useState(false);
```

- [ ] **Step 4: Render the sign-in entry point and destination toggle**

Find the block containing the "Named saves" heading (identified during exploration at the point where `{(onSaveNamedProject || namedProjects.length > 0) && (` opens, right after the section's border-top wrapper `<div>`). Immediately **before** that `<div style={{ fontSize: 11, color: "var(--text-muted)", ... }}>Named saves — keep several...</div>` line, insert the sign-in block — gated entirely on `cloudConfigured` so the feature is invisible when no Supabase project is set up:

```tsx
                  {cloudConfigured && (
                    <div style={{ marginBottom: 10 }}>
                      {session ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 12,
                            color: "var(--text-secondary)",
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {session.user.email}
                          </span>
                          <button
                            type="button"
                            onClick={() => onSignOut?.()}
                            className="layerIconBtn"
                            style={{ width: "auto", padding: "0 8px", fontSize: 11 }}
                          >
                            Sign out
                          </button>
                        </div>
                      ) : showSignInForm ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input
                              type="email"
                              value={signInEmail}
                              onChange={(e) => setSignInEmail(e.target.value)}
                              placeholder="you@example.com"
                              className="hexInput"
                              style={{ fontFamily: "inherit", letterSpacing: 0 }}
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                if (!signInEmail.trim() || !onSignIn) return;
                                const { error } = await onSignIn(signInEmail.trim());
                                setSignInStatus(
                                  error ? { kind: "error", message: error } : { kind: "sent" }
                                );
                              }}
                              disabled={!signInEmail.trim()}
                              className="sidebarPillButton"
                              style={{ flex: "0 0 auto" }}
                            >
                              Send link
                            </button>
                          </div>
                          {signInStatus.kind === "sent" && (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              Check your email for a sign-in link.
                            </span>
                          )}
                          {signInStatus.kind === "error" && (
                            <span style={{ fontSize: 11, color: "var(--danger)" }}>
                              {signInStatus.message}
                            </span>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowSignInForm(true)}
                          className="layerIconBtn"
                          style={{ width: "auto", padding: "0 8px", fontSize: 11 }}
                        >
                          Sign in to save projects to the cloud
                        </button>
                      )}
                    </div>
                  )}
```

- [ ] **Step 5: Add the Local/Cloud destination toggle next to "Save As"**

Find the `<div style={{ display: "flex", gap: 8 }}>` block containing the `namedProjectInput` text input and "Save As" button (identified during exploration). Immediately **before** that `<div>`, insert the toggle — only rendered when `cloudConfigured` is true (when cloud isn't configured, saves always go local, matching today's behavior exactly):

```tsx
                  {cloudConfigured && (
                    <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                      <button
                        type="button"
                        onClick={() => onChangeSaveDestination?.("local")}
                        className={
                          saveDestination === "local"
                            ? "sidebarPillButton sidebarPillButton--active"
                            : "sidebarPillButton"
                        }
                        style={{ flex: "0 0 auto", padding: "0 10px" }}
                      >
                        Local
                      </button>
                      <button
                        type="button"
                        onClick={() => session && onChangeSaveDestination?.("cloud")}
                        disabled={!session}
                        title={session ? undefined : "Sign in to save to cloud"}
                        className={
                          saveDestination === "cloud"
                            ? "sidebarPillButton sidebarPillButton--active"
                            : "sidebarPillButton"
                        }
                        style={{ flex: "0 0 auto", padding: "0 10px" }}
                      >
                        Cloud
                      </button>
                    </div>
                  )}
```

- [ ] **Step 6: Add source badges and route Load/Delete by source**

Find the project-list row rendering (identified during exploration: `{namedProjects.map((p) => ( <div key={p.name} ...`). Note `key={p.name}` is no longer unique once local and cloud can share a name — change it to `key={`${p.source}:${p.name}`}`. Add a badge span before the name span, and update the Load/Delete `onClick` handlers to pass `p.source`:

Find:

```tsx
                      {namedProjects.map((p) => (
                        <div
                          key={p.name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            background: "var(--row-bg)",
                            borderRadius: 8,
                            padding: "5px 7px",
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              fontSize: 12,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: "var(--text-primary)",
                            }}
                            title={new Date(p.savedAt).toLocaleString()}
                          >
                            {p.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => onLoadNamedProject?.(p.name)}
                            className="layerIconBtn"
                            title="Load this project"
                            aria-label={`Load ${p.name}`}
                          >
                            <FolderOpenIcon size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteNamedProject?.(p.name)}
                            className="layerIconBtn"
                            title="Delete this saved project"
                            aria-label={`Delete ${p.name}`}
                            style={{ color: "var(--danger)" }}
                          >
```

Replace with:

```tsx
                      {namedProjects.map((p) => (
                        <div
                          key={`${p.source}:${p.name}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            background: "var(--row-bg)",
                            borderRadius: 8,
                            padding: "5px 7px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: "var(--text-muted)",
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                              flex: "0 0 auto",
                            }}
                          >
                            {p.source === "cloud" ? "Cloud" : "Local"}
                          </span>
                          <span
                            style={{
                              flex: 1,
                              fontSize: 12,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: "var(--text-primary)",
                            }}
                            title={new Date(p.savedAt).toLocaleString()}
                          >
                            {p.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => onLoadNamedProject?.(p.name, p.source)}
                            className="layerIconBtn"
                            title="Load this project"
                            aria-label={`Load ${p.name}`}
                          >
                            <FolderOpenIcon size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteNamedProject?.(p.name, p.source)}
                            className="layerIconBtn"
                            title="Delete this saved project"
                            aria-label={`Delete ${p.name}`}
                            style={{ color: "var(--danger)" }}
                          >
```

- [ ] **Step 7: Find and update the caller of `requestDeleteNamedProject`/`onDeleteNamedProject` in `App.tsx`'s prop wiring**

`Sidebar.tsx`'s `onDeleteNamedProject` prop is bound in `App.tsx` to `requestDeleteNamedProject` (from Task 3, now `(name, source)`). Confirm in `App.tsx` that the `<Sidebar onDeleteNamedProject={requestDeleteNamedProject} ... />` prop wiring needs no change (the function reference itself is the same; only its signature grew a parameter, and `Sidebar.tsx` now calls it with two arguments) — no edit needed here beyond what Task 3 already did, this step is a verification, not a code change.

- [ ] **Step 8: Add the active-toggle CSS**

In `src/index.css`, find the `.sidebarPillButton` rule block:

```css
.sidebarPillButton { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 999px; border: none; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 500; cursor: pointer; transition: background 0.12s, transform 0.08s, box-shadow 0.08s; flex: 1 1 auto; min-width: 0; white-space: nowrap; box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12); }
.sidebarPillButton:hover:not(:disabled) { background: var(--accent-soft-hover); color: var(--text-on-accent); }
.sidebarPillButton:active:not(:disabled) { transform: translateY(1px); box-shadow: none; }
.sidebarPillButton:disabled { opacity: 0.35; cursor: not-allowed; }
```

Add immediately after it:

```css
.sidebarPillButton--active { background: var(--accent); color: var(--text-on-accent); }
.sidebarPillButton--active:hover:not(:disabled) { background: var(--accent); filter: brightness(1.1); }
```

- [ ] **Step 9: Typecheck, lint, build**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run build`
Expected: all succeed with no errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/Sidebar.tsx src/index.css
git commit -m "Add sign-in UI, save-destination toggle, and cloud/local badges to Sidebar"
```

---

### Task 5: Docs, full verification pass, and manual cloud verification checklist

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** None — documentation and verification only.

- [ ] **Step 1: Document the feature in `CLAUDE.md`**

Add a new subsection under the existing persistence-related documentation (find where "Undo/redo and grouping" or the Sidebar structure sections live, and add a new bullet/section after them, following this codebase's existing prose style — dense paragraphs explaining the non-obvious "why", not a feature list):

```markdown
### Cloud persistence (`src/lib/supabaseClient.ts`, `src/lib/cloudProjects.ts`)

Named saves (`namedProjects` in `App.tsx`) can optionally live in a
Supabase-backed cloud account instead of (or alongside) the existing
per-browser `localStorage` named-projects store — autosave and glyph rigs
remain local-only, untouched. `supabaseClient.ts`'s `supabase` export is
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
```

- [ ] **Step 2: Full verification pass**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass cleanly.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document cloud persistence in CLAUDE.md"
```

- [ ] **Step 4: Manual verification checklist (report to the human partner, not automatable in this environment)**

There is no live Supabase project available in this build environment, so this step cannot be executed by an agent — it must be run by the user after configuring `.env` per the Prerequisites in the design spec:

1. Confirm the app loads and looks completely unchanged when `.env` has no Supabase values set (no sign-in UI visible anywhere in the sidebar).
2. Add real `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` to `.env`, restart the dev server, run the SQL migration in the Supabase SQL editor.
3. Confirm the "Sign in to save projects to the cloud" link now appears; enter a real email, click "Send link", confirm the "Check your email" message appears.
4. Click the magic link in the received email; confirm it lands back in the app signed in (email shown, "Sign out" link present).
5. Toggle "Cloud", save a named project, confirm it appears in the list tagged "Cloud".
6. Reload the page (or open a different browser signed into the same account); confirm the cloud project is still loadable.
7. Delete the cloud project; confirm it disappears from the list and a second load attempt fails gracefully.
8. Confirm existing local named-project save/load/delete still works exactly as before, unaffected.
9. Sign out; confirm the Cloud toggle becomes disabled and previously-visible cloud projects disappear from the list (they remain in the account, just not fetched while signed out).
