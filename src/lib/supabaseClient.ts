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
