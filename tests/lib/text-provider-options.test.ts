import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { textProviderOptions } from "@/lib/models/generate";
import { AGENT_MODELS } from "@/config/agents";

// 10 November 2026: Claude 5.5 models thought before answering, the thinking used up each
// agent's maxOutputTokens and replies were cut off mid-JSON. Text calls now turn thinking off.

async function requestBody(model: string): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text: "{}" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  await generateText({
    model: createAnthropic({ apiKey: "test-not-a-key", fetch })(model),
    prompt: "Reply with {}",
    maxOutputTokens: 600,
    providerOptions: textProviderOptions("anthropic"),
    maxRetries: 0,
  });
  return body;
}

describe("text calls turn thinking off", () => {
  it("Anthropic text calls ask for no thinking; other providers get no options", () => {
    expect(textProviderOptions("anthropic")).toEqual({ anthropic: { thinking: { type: "disabled" } } });
    expect(textProviderOptions("mock")).toBeUndefined();
    expect(textProviderOptions("google")).toBeUndefined();
  });

  it("Haiku 5.5 is sent thinking disabled, so all of maxOutputTokens is left for the reply", async () => {
    const body = await requestBody("claude-haiku-5-5");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.max_tokens).toBe(600);
  });

  it("Sonnet 5.5 is sent its lowest setting, with no thinking before the answer", async () => {
    const body = await requestBody("claude-sonnet-5-5");
    expect(body.thinking).not.toEqual({ type: "adaptive" });
    expect(JSON.stringify(body.thinking ?? null)).not.toContain("adaptive");
  });

  it("every agent on Anthropic is a Haiku or Sonnet 5.5 model, which these options cover", () => {
    for (const cfg of Object.values(AGENT_MODELS)) {
      if (cfg.provider === "anthropic") expect(cfg.model).toMatch(/^claude-(haiku|sonnet)-5-5$/);
    }
  });
});
