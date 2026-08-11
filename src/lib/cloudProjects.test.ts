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
      from: () => ({
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
