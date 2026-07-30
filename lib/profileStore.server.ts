import { get, put } from "@vercel/blob";
import { Profile } from "./types";

// Server-only persistence for the candidate's Profile + Master CV, backed
// by a private Vercel Blob store. This is what makes the data survive
// incognito windows, other browsers, and other machines — localStorage
// (still used as a fast local cache, see lib/persist.ts) never did and
// structurally can't.
//
// Single fixed pathname, overwritten in place (addRandomSuffix: false,
// allowOverwrite: true) — this app is single-user (gated by SITE_PASSWORD,
// no accounts), so there's exactly one stored profile, not one per user.
// access: "private" means the blob requires the read-write token to
// fetch — it's never publicly reachable by URL, unlike a "public" blob.
const PATHNAME = "jobhunter/profile.json";

export interface StoredProfileBundle {
  profile: Profile;
  masterCV: string;
}

export async function loadStoredProfile(): Promise<StoredProfileBundle | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    // Passing `token` explicitly forces token-based auth instead of the
    // SDK's default OIDC auto-detection — locally, `vercel env pull` also
    // adds VERCEL_OIDC_TOKEN, and the SDK prefers that over this token if
    // present, which then fails ("OIDC ... not ... for development") since
    // OIDC isn't enabled for the dev environment. The plain token always
    // works, so just always use it.
    // useCache: false — this is a low-traffic single-record store where
    // correctness (always the latest write) matters far more than shaving
    // latency via the CDN; the default cache otherwise serves stale reads
    // right after a write, which is exactly the failure mode to avoid here.
    const result = await get(PATHNAME, { access: "private", token, useCache: false });
    if (!result?.stream) return null;
    const text = await new Response(result.stream as any).text();
    return JSON.parse(text) as StoredProfileBundle;
  } catch {
    // Not found yet (first-ever save) or the store isn't reachable —
    // callers fall back to their own default/local copy either way.
    return null;
  }
}

export async function saveStoredProfile(bundle: StoredProfileBundle): Promise<boolean> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;
  try {
    await put(PATHNAME, JSON.stringify(bundle), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token,
    });
    return true;
  } catch (err) {
    console.error("saveStoredProfile: failed to write to Vercel Blob", err);
    return false;
  }
}
