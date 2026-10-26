// Reads a public web page as plain text, so code can check that a figure an
// agent quotes is really on the page it cites (S4-3, production check). Not a
// model call (rule 5 is about model calls); nothing is stored but the result
// of the check.
//
// Only pages a web search returned are read, and only over https to a named
// host (no IP addresses, no local names), with a short timeout and a size limit.

const TIMEOUT_MS = 8000;
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 3;

export type PageReader = (url: string) => Promise<string | null>;

function allowed(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[") || /^[\d.]+$/.test(host)) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|test|example|invalid)$/.test(host)) return null;
  if (u.port && u.port !== "443") return null;
  return u;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", euro: "€", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…", percnt: "%" };

/** HTML to readable text: scripts, styles and tags removed, entities decoded, spaces collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(p|div|br|li|tr|td|th|h[1-6]|section|article|header|footer|ul|ol|table|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t\r\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

async function readOnce(start: string): Promise<string | null> {
  let url = allowed(start);
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "Mozilla/5.0 (compatible; StudioCheck/1.0; checks figures quoted from this page)", accept: "text/html,text/plain;q=0.9" },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      url = next ? allowed(new URL(next, url).toString()) : null;
      continue;
    }
    if (!res.ok || !res.body) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return /html/.test(type) ? htmlToText(text) : text;
  }
  return null;
}

/** The real reader; tests replace `pageReader.read`. Failures are null, never thrown. */
export const pageReader: { read: PageReader } = {
  read: async (url) => {
    try {
      return await readOnce(url);
    } catch {
      return null;
    }
  },
};

/** One reader per model step, so a page is read once even across the repair attempt. */
export function cachedReader(): PageReader {
  const cache = new Map<string, Promise<string | null>>();
  return (url) => {
    const key = url.replace(/#.*$/, "");
    if (!cache.has(key)) cache.set(key, pageReader.read(key));
    return cache.get(key)!;
  };
}
