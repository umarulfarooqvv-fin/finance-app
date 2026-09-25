import { addSeconds, type Instant } from '@/lib/time';

/* ===========================================================================
   How much of the AI provider's allowance is left.

   A free tier is a quota — Groq's for the vision model is 1,000 requests a
   day — and running out used to look like the feature breaking: photos
   arriving and never being read, a tile saying "429" and nothing else. This
   reads what the provider already reports on every reply (Groq and OpenRouter
   send `x-ratelimit-*` headers; a 429 carries `retry-after` and says which
   limit in its message) so the app can say "812 of 1,000 left" and, when the
   well is dry, "reads resume around 17:05".

   Pure: headers and text in, a value out. Storing it is capture-drafts' and
   the routes' business (see usage-store.ts).
   =========================================================================== */

export type Allowance = {
  limit: number;
  remaining: number;
  /** When it is back to full, per the provider. Null when it did not say. */
  resetsAt: Instant | null;
};

export type AiUsage = {
  /** Which provider and model, as shown elsewhere ("api.groq.com (model)"). */
  provider: string;
  /** When this was observed. */
  at: Instant;
  requests?: Allowance;
  tokens?: Allowance;
  /** Set while the provider is refusing because a limit was reached. */
  limitedUntil?: Instant | null;
  /** Which limit, in words: "requests per day". */
  limitKind?: string | null;
};

/** "8m38.4s", "105ms", "1h2m3s", "7.66s", or bare seconds → milliseconds. */
export function parseDuration(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.trim();
  if (/^\d+(?:\.\d+)?$/.test(t)) return Math.round(Number(t) * 1000);
  let ms = 0;
  let matched = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const n = Number(m[1]);
    ms += m[2] === 'h' ? n * 3_600_000 : m[2] === 'm' ? n * 60_000 : m[2] === 's' ? n * 1_000 : n;
  }
  return matched ? Math.round(ms) : null;
}

type HeaderSource = { get(name: string): string | null };

function allowance(h: HeaderSource, kind: 'requests' | 'tokens', now: Instant): Allowance | undefined {
  const limit = Number(h.get(`x-ratelimit-limit-${kind}`));
  const remaining = Number(h.get(`x-ratelimit-remaining-${kind}`));
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(remaining)) return undefined;
  const reset = parseDuration(h.get(`x-ratelimit-reset-${kind}`));
  return {
    limit,
    remaining: Math.max(0, remaining),
    resetsAt: reset === null ? null : addSeconds(now, Math.ceil(reset / 1000)),
  };
}

const KINDS: Record<string, string> = {
  RPD: 'requests per day',
  RPM: 'requests per minute',
  TPD: 'tokens per day',
  TPM: 'tokens per minute',
};

/**
 * What one reply says about the allowance. `status` and `body` matter only
 * for a 429, where the provider says which limit it hit and for how long.
 */
export function usageFromReply(
  provider: string,
  now: Instant,
  status: number,
  headers: HeaderSource,
  body = '',
): AiUsage {
  const usage: AiUsage = { provider, at: now };
  const requests = allowance(headers, 'requests', now);
  const tokens = allowance(headers, 'tokens', now);
  if (requests) usage.requests = requests;
  if (tokens) usage.tokens = tokens;

  if (status === 429) {
    // Groq: "... on requests per day (RPD): Limit 1000, Used 1000 ... Please
    // try again in 7m12.5s." The header is the fallback, not the first choice:
    // it rounds, and some providers leave it out.
    const wait = parseDuration(/try again in ([\d.hms]+)/i.exec(body)?.[1])
      ?? parseDuration(headers.get('retry-after'));
    const code = /\((RPD|RPM|TPD|TPM)\)/.exec(body)?.[1];
    usage.limitKind = code ? KINDS[code]! : (/per day/i.test(body) ? 'daily limit' : 'rate limit');
    // No stated wait: assume a minute rather than guess a day. A short guess
    // costs one wasted request; a long one strands every photo until tomorrow.
    usage.limitedUntil = addSeconds(now, Math.ceil((wait ?? 60_000) / 1000));
    if (usage.requests && code === 'RPD') usage.requests.remaining = 0;
  }
  return usage;
}

/** True while a recorded limit still applies. Instants compare as strings. */
export function isLimited(usage: AiUsage | null | undefined, now: Instant): boolean {
  return Boolean(usage?.limitedUntil && usage.limitedUntil > now);
}

export type UsageLine = { tone: 'ok' | 'low' | 'limited'; text: string };

const hhmm = (t: Instant) => {
  const h = Number(t.slice(11, 13));
  const m = t.slice(14, 16);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
};

/**
 * One line for the screen, or null when there is nothing worth saying (no
 * reading yet, or a provider that reports no allowance at all).
 */
export function describeUsage(usage: AiUsage | null | undefined, now: Instant): UsageLine | null {
  if (!usage) return null;

  if (isLimited(usage, now)) {
    const same = usage.limitedUntil!.slice(0, 10) === now.slice(0, 10);
    const when = same ? hhmm(usage.limitedUntil!) : `${usage.limitedUntil!.slice(8, 10)}/${usage.limitedUntil!.slice(5, 7)} ${hhmm(usage.limitedUntil!)}`;
    return {
      tone: 'limited',
      text: `AI limit reached (${usage.limitKind ?? 'rate limit'}). Reading resumes around ${when} — `
        + 'photos still arrive and are kept, and are read after that.',
    };
  }

  const r = usage.requests;
  if (!r) return null;
  // Past its reset the allowance is full again, whatever was last seen.
  const remaining = r.resetsAt && r.resetsAt <= now ? r.limit : r.remaining;
  const n = (x: number) => x.toLocaleString('en-IN');
  return {
    tone: remaining / r.limit < 0.1 ? 'low' : 'ok',
    text: `${n(remaining)} of ${n(r.limit)} AI reads left today`,
  };
}
