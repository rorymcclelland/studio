import { MockImageModelV4, MockLanguageModelV4 } from "ai/test";
import { drawMockImage } from "./mock-image";

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
  /** Milliseconds each call takes, so tests can start calls that overlap (F-21). */
  delayMs = 0;
  /** Pictures sent with the last text call (S5-1's vision check). */
  lastImageCount = 0;
  /**
   * The vision check's answer (S5-1): whether the picture "has text". Tests
   * replace it to force a yes, e.g. for one picture by its number in the prompt.
   */
  visionHasText: (prompt: string) => boolean = () => false;
  /** Image calls made, the last image prompt, and queued image failures. */
  imageCalls = 0;
  lastImagePrompt = "";
  /** Queued image failures: a message, or an error to throw as it is (e.g. a provider's 400). */
  imageFailures: (string | Error)[] = [];

  reset() {
    this.searchPages = DEFAULT_PAGES;
    this.searchCount = 2;
    this.queue = [];
    this.calls = 0;
    this.lastPrompt = "";
    this.delayMs = 0;
    this.lastImageCount = 0;
    this.visionHasText = () => false;
    this.imageCalls = 0;
    this.lastImagePrompt = "";
    this.imageFailures = [];
  }
  failImage(message: string | Error, times = 1) {
    for (let i = 0; i < times; i++) this.imageFailures.push(message);
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
  // Flatten whatever the SDK passes so tests can inspect it; a picture's bytes become a short placeholder.
  return JSON.stringify((options as { prompt?: unknown }).prompt ?? options, (_k, v: unknown) =>
    v instanceof Uint8Array ? `[${v.length} bytes]` : v,
  );
}

// What a 1K picture costs in input tokens on Claude (about width x height / 750).
const MOCK_TOKENS_PER_IMAGE = 1_400;

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

/** Image parts in the prompt (the SDK passes them to the model as image files). */
function imageParts(options: unknown): number {
  const prompt = (options as { prompt?: unknown }).prompt;
  if (!Array.isArray(prompt)) return 0;
  let n = 0;
  for (const m of prompt as { content?: unknown }[]) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content as { type?: string; mediaType?: string }[]) {
      if (p.type === "file" && typeof p.mediaType === "string" && p.mediaType.startsWith("image")) n += 1;
    }
  }
  return n;
}

/**
 * The mock image model (S5-1): soft shapes in the palette passed as
 * `providerOptions.mock.palette`, stamped "Simulated image". Deterministic for
 * a prompt, palette and seed, and priced like the real model in the ledger.
 */
export function createMockImageModel(): MockImageModelV4 {
  return new MockImageModelV4({
    provider: "mock",
    modelId: "mock-image",
    maxImagesPerCall: 1,
    doGenerate: async (options) => {
      mockBehaviour.imageCalls += 1;
      mockBehaviour.lastImagePrompt = options.prompt ?? "";
      if (mockBehaviour.delayMs > 0) await new Promise((r) => setTimeout(r, mockBehaviour.delayMs));
      const failure = mockBehaviour.imageFailures.shift();
      if (failure) throw typeof failure === "string" ? new Error(failure) : failure;
      const mock = options.providerOptions?.mock as { palette?: unknown; size?: unknown } | undefined;
      const palette = mock?.palette;
      const png = await drawMockImage({
        prompt: options.prompt ?? "",
        palette: Array.isArray(palette) ? palette.filter((p): p is string => typeof p === "string") : [],
        aspect: options.aspectRatio ?? "1:1",
        seed: options.seed,
        size: mock?.size === "2K" ? "2K" : "1K",
      });
      const inputTokens = Math.ceil((options.prompt ?? "").length / 4);
      return {
        images: [png],
        warnings: [],
        response: { timestamp: new Date(), modelId: "mock-image", headers: undefined },
        usage: { inputTokens, outputTokens: 0, totalTokens: inputTokens },
      };
    },
  });
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
      mockBehaviour.lastImageCount = imageParts(options);
      const queued = mockBehaviour.queue.shift();
      if (mockBehaviour.delayMs > 0) await new Promise((r) => setTimeout(r, mockBehaviour.delayMs));
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
          inputTokens: Math.ceil(text.length / 4) + mockBehaviour.lastImageCount * MOCK_TOKENS_PER_IMAGE,
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
