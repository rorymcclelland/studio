import { MockLanguageModelV4 } from "ai/test";

// A deterministic stand-in model for tests, local development and the build
// workspace. Tests queue responses or failures; otherwise a responder
// registered by the agent answers, so the app works end to end offline.

type Queued =
  | { kind: "ok"; text: string; inputTokens: number; outputTokens: number }
  | { kind: "fail"; message: string };

type Responder = (prompt: string) => string;

// Fixed, clearly fictional pages for offline market research (example.test never resolves).
const DEFAULT_PAGES = [
  { url: "https://outdoor-trends.example.test/winter-2026", title: "Winter walking trends 2026 (sample page)", citedText: "Sales of insulated jackets rose 12% in the autumn, with recycled fill the most asked-for feature." },
  { url: "https://retail-notes.example.test/repair", title: "Repair services in outdoor retail (sample page)", citedText: "Several outdoor chains now offer in-store repair, and Cairnwick Outdoor (a fictional chain) launched a mail-in repair service in September." },
  { url: "https://walking-news.example.test/season", title: "When people buy winter kit (sample page)", citedText: "Most winter kit is bought between October and December, peaking in the first cold weekend." },
];

class MockBehaviour {
  queue: Queued[] = [];
  calls = 0;
  lastPrompt = "";
  responders: Responder[] = [];
  /** Pages the mock "finds" when a call offers web search (S4-3). Tests may replace them. */
  searchPages: { url: string; title: string; citedText: string }[] = DEFAULT_PAGES;
  /** Searches the mock reports making for a call that offers web search. */
  searchCount = 2;
  /** The last prompt's message text, unescaped. */
  lastPlainPrompt = "";

  reset() {
    this.searchPages = DEFAULT_PAGES;
    this.searchCount = 2;
    this.queue = [];
    this.calls = 0;
    this.lastPrompt = "";
  }
  next(r: { text: string; inputTokens: number; outputTokens: number }) {
    this.queue.push({ kind: "ok", ...r });
  }
  fail(message: string, times = 1) {
    for (let i = 0; i < times; i++) this.queue.push({ kind: "fail", message });
  }
  respondWith(fn: Responder) {
    this.responders.push(fn);
  }
}

declare global {
  var __csMock: MockBehaviour | undefined;
}
export const mockBehaviour: MockBehaviour = (globalThis.__csMock ??= new MockBehaviour());

function promptText(options: unknown): string {
  // Flatten whatever the SDK passes so tests can inspect it.
  return JSON.stringify((options as { prompt?: unknown }).prompt ?? options);
}

/** The messages' text, unescaped, for offline answers that read the prompt. */
function plainText(options: unknown): string {
  const prompt = (options as { prompt?: unknown }).prompt;
  if (!Array.isArray(prompt)) return promptText(options);
  return prompt
    .map((m: { content?: unknown }) =>
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n")
          : "",
    )
    .join("\n");
}

export function createMockModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    modelId: "mock-model",
    provider: "mock",
    doGenerate: async (options) => {
      mockBehaviour.calls += 1;
      const text = promptText(options);
      mockBehaviour.lastPrompt = text;
      const plain = plainText(options);
      mockBehaviour.lastPlainPrompt = plain;
      const queued = mockBehaviour.queue.shift();
      if (queued?.kind === "fail") throw new Error(queued.message);
      let out: { text: string; inputTokens: number; outputTokens: number };
      if (queued) out = queued;
      else {
        let answer = "";
        for (const r of mockBehaviour.responders) {
          answer = r(plain);
          if (answer) break;
        }
        out = {
          text: answer || "Mock response",
          inputTokens: Math.ceil(text.length / 4),
          outputTokens: Math.ceil((answer || "Mock response").length / 4),
        };
      }
      const searching = Array.isArray((options as { tools?: unknown[] }).tools) && ((options as { tools?: unknown[] }).tools ?? []).length > 0;
      const sources = searching
        ? mockBehaviour.searchPages.map((p, i) => ({
            type: "source" as const,
            sourceType: "url" as const,
            id: `mock-source-${i}`,
            url: p.url,
            title: p.title,
            providerMetadata: { anthropic: { citedText: p.citedText } },
          }))
        : [];
      return {
        content: [{ type: "text", text: out.text }, ...sources],
        providerMetadata: searching ? { anthropic: { usage: { server_tool_use: { web_search_requests: mockBehaviour.searchCount } } } } : undefined,
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: out.inputTokens, noCache: out.inputTokens, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: out.outputTokens, text: out.outputTokens, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
