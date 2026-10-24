import { MockLanguageModelV4 } from "ai/test";

// A deterministic stand-in model for tests, local development and the build
// workspace. Tests queue responses or failures; otherwise a responder
// registered by the agent answers, so the app works end to end offline.

type Queued =
  | { kind: "ok"; text: string; inputTokens: number; outputTokens: number }
  | { kind: "fail"; message: string };

type Responder = (prompt: string) => string;

class MockBehaviour {
  queue: Queued[] = [];
  calls = 0;
  lastPrompt = "";
  responders: Responder[] = [];

  reset() {
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

export function createMockModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    modelId: "mock-model",
    provider: "mock",
    doGenerate: async (options) => {
      mockBehaviour.calls += 1;
      const text = promptText(options);
      mockBehaviour.lastPrompt = text;
      const queued = mockBehaviour.queue.shift();
      if (queued?.kind === "fail") throw new Error(queued.message);
      let out: { text: string; inputTokens: number; outputTokens: number };
      if (queued) out = queued;
      else {
        let answer = "";
        for (const r of mockBehaviour.responders) {
          answer = r(text);
          if (answer) break;
        }
        out = {
          text: answer || "Mock response",
          inputTokens: Math.ceil(text.length / 4),
          outputTokens: Math.ceil((answer || "Mock response").length / 4),
        };
      }
      return {
        content: [{ type: "text", text: out.text }],
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
