import { NextResponse } from "next/server";
import { loadStoredProfile, saveStoredProfile } from "@/lib/profileStore.server";

export const dynamic = "force-dynamic";

// GET/PUT for the single stored Profile + Master CV (Vercel Blob-backed —
// see lib/profileStore.server.ts). Already behind the site-wide password
// gate in middleware.ts, same as every other route here.
export async function GET() {
  const stored = await loadStoredProfile();
  if (!stored) return NextResponse.json({ found: false });
  return NextResponse.json({ found: true, ...stored });
}

export async function PUT(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { profile, masterCV } = body || {};
  if (!profile || typeof masterCV !== "string") {
    return NextResponse.json({ error: "Both profile and masterCV are required." }, { status: 400 });
  }

  const ok = await saveStoredProfile({ profile, masterCV });
  if (!ok) {
    return NextResponse.json(
      { error: "Blob storage isn't configured (missing BLOB_READ_WRITE_TOKEN) or the write failed." },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true });
}
