"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        setError("Incorrect password.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-beacon animate-pulseDot" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-beacon" />
          </span>
          <div className="font-display text-lg font-semibold tracking-tight text-bright">
            Job<span className="text-beacon">Hunter</span>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6">
          <h1 className="font-display text-lg font-semibold text-bright">Enter password</h1>
          <p className="mt-1.5 text-sm text-soft">This demo is password-protected to prevent unwanted API usage.</p>

          <div className="mt-5">
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Password"
              className="w-full rounded-lg border border-line bg-ink px-3.5 py-3 text-bright outline-none transition placeholder:text-soft/50 focus:border-beacon/70"
            />
            {error && <p className="mt-2 text-sm text-weak">{error}</p>}
            <button
              onClick={submit}
              disabled={loading || !password}
              className="mt-4 w-full rounded-lg bg-beacon px-5 py-3 font-medium text-ink transition hover:brightness-105 disabled:opacity-60"
            >
              {loading ? "Checking…" : "Enter"}
            </button>
          </div>

          <p className="mt-5 text-center text-xs leading-relaxed text-soft/70">
            To get realistic, up-to-date live data, contact{" "}
            <a href="mailto:mustufa50@gmail.com" className="text-beacon hover:underline">
              mustufa50@gmail.com
            </a>{" "}
            for the password.
          </p>
        </div>
      </div>
    </main>
  );
}
