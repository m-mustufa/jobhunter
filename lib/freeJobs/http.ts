import "server-only";

import { load } from "cheerio";

// Lever can take ~7s to answer a full board, so leave generous headroom.
const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "jobhunter/1.0 (personal job search; reads public career-site APIs)";

// One retry for the failures that are usually momentary: a timeout, a dropped
// connection, a 429 or a 5xx. The overall sync deadline still wins.
async function fetchWithRetry(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        cache: "no-store",
      });
      if (response.status !== 429 && response.status < 500) return response;
      lastError = new Error(`${response.status} from ${new URL(url).host}`);
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw lastError instanceof Error ? lastError : new Error("request failed");
}

export async function fetchJson<T>(
  url: string,
  signal: AbortSignal,
  init: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<T> {
  const response = await fetchWithRetry(url, {
    method: init.method || "GET",
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  }, signal);
  if (!response.ok) {
    throw new Error(`${response.status} from ${new URL(url).host}`);
  }
  return (await response.json()) as T;
}

/** Turns an HTML fragment into readable plain text, keeping paragraph and bullet breaks. */
export function htmlToText(html: string): string {
  if (!html) return "";
  // Some platforms (Greenhouse) return the HTML entity-encoded.
  const source = /&lt;\s*\/?\s*[a-z]/i.test(html) ? load(html).text() : html;
  const $ = load(source, undefined, false);
  $("br").replaceWith("\n");
  $("li").each((_, el) => {
    $(el).prepend("• ").append("\n");
  });
  $("p, div, h1, h2, h3, h4, h5, h6, ul, ol, tr").each((_, el) => {
    $(el).append("\n");
  });
  return $.root()
    .text()
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Runs `task` over `items` with at most `limit` in flight. A failed item is
 * skipped (and counted by the caller through the returned `failed` total)
 * instead of failing the whole batch.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<{ results: R[]; failed: number }> {
  const results: R[] = [];
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        results.push(await task(item));
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { results, failed };
}

export async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetchWithRetry(url, {
    headers: { accept: "text/html,application/xml;q=0.9,*/*;q=0.8", "user-agent": USER_AGENT },
  }, signal);
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`);
  return response.text();
}
