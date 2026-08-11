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
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select("payload")
    .eq("name", name)
    .eq("user_id", userId)
    .single();
  if (error || !data) return null;
  return { payload: data.payload };
}

export async function deleteCloudProject(name: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: NOT_CONFIGURED };
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return { error: "Not signed in." };
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("name", name)
    .eq("user_id", userId);
  return { error: error?.message ?? null };
}
