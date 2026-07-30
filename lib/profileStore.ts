import { Profile } from "./types";

// Client-side helpers for the server-backed Profile store (app/api/profile,
// backed by Vercel Blob — see lib/profileStore.server.ts). This is the
// durable copy that survives incognito windows and other browsers/devices;
// localStorage (lib/persist.ts) is kept alongside it purely as a fast local
// cache and offline fallback, not the source of truth anymore.
export interface ProfileBundle {
  profile: Profile;
  masterCV: string;
}

export async function fetchStoredProfile(): Promise<ProfileBundle | null> {
  try {
    const r = await fetch("/api/profile", { cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json();
    return data.found ? { profile: data.profile, masterCV: data.masterCV } : null;
  } catch {
    return null;
  }
}

export async function pushStoredProfile(bundle: ProfileBundle): Promise<boolean> {
  try {
    const r = await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bundle),
    });
    return r.ok;
  } catch {
    return false;
  }
}
