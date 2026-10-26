// S5-1: generateImage() through the cap, reservation and ledger; the mock image
// model; vision input on generate(); image model config; colour words.
import { APICallError } from "ai";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolveImageModel } from "@/config/agents";
import { colourWords, paletteWords } from "@/lib/creative/colour-words";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { imageCostPence } from "@/lib/models/cost";
import { CapExceededError, generate, generateImage, imageFailureMayBeBilled, ProviderError } from "@/lib/models/generate";
import { mockBehaviour } from "@/lib/models/mock";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };
const PALETTE = ["#14213D", "#1F4E79", "#F2C14E", "#F7F5F0", "#6B9080"];
const draw = (m: Member, over: Partial<Parameters<typeof generateImage>[0]> = {}) =>
  generateImage({ agent: "imagery", userId: m.userId, workspaceId: m.workspaceId, prompt: "A calm still life in deep blue tones", aspect: "1:1", palette: PALETTE, ...over });
const ledger = (m: Member) => asUser(m.userId, (tx) => tx`select * from public.usage_ledger order by id`);
const reservations = (m: Member) => asUser(m.userId, (tx) => tx`select * from public.spend_reservations`);
const MOCK_IMAGE_PENCE = 0.0336 * 0.79 * 100;

describe("S5-1 generateImage()", () => {
  beforeEach(async () => {
    await truncateAll();
    mockBehaviour.reset();
  });
  afterAll(closeSql);

  it("draws a mock picture, charges one image at the mock price and leaves no reservation", async () => {
    const m = await createMember();
    const img = await draw(m);
    expect(img).toMatchObject({ provider: "mock", model: "mock-image", size: "1K", simulated: true, mediaType: "image/png" });
    const meta = await sharp(img.bytes).metadata();
    expect(meta).toMatchObject({ format: "png", width: 1024, height: 1024 });
    expect(imageCostPence("mock", "mock-image", "1K", 1)).toBeCloseTo(MOCK_IMAGE_PENCE, 6);
    expect(img.costPence).toBeCloseTo(MOCK_IMAGE_PENCE, 6);
    const [row] = await ledger(m);
    expect(row).toMatchObject({ agent: "imagery", provider: "mock", model: "mock-image", images: 1, output_tokens: 0 });
    expect(Number(row.cost_pence)).toBeCloseTo(MOCK_IMAGE_PENCE, 4);
    expect(await reservations(m)).toHaveLength(0);
  });

  it("the mock picture is deterministic for a prompt, palette and seed, and differs for another seed", async () => {
    const m = await createMember();
    const a = await draw(m, { seed: 1 });
    const b = await draw(m, { seed: 1 });
    const c = await draw(m, { seed: 2 });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect(Buffer.from(a.bytes).equals(Buffer.from(c.bytes))).toBe(false);
  });

  it("a picture that would cross the cap is refused before it is drawn", async () => {
    const m = await createMember();
    await asUser(m.userId, (tx) => tx`
      insert into public.usage_ledger (workspace_id, agent, provider, model, input_tokens, output_tokens, cost_pence)
      values (${m.workspaceId}, 'imagery', 'mock', 'mock-model', 0, 0, 48)`); // 2p left of the workspace's 50p
    await expect(draw(m)).rejects.toBeInstanceOf(CapExceededError);
    expect(mockBehaviour.imageCalls).toBe(0);
    expect(await ledger(m)).toHaveLength(1);
    expect(await reservations(m)).toHaveLength(0);
  });

  it("a failed picture is not retried, and is charged in full when the provider may have billed it", async () => {
    const m = await createMember();
    mockBehaviour.failImage("Internal error", 2);
    await expect(draw(m)).rejects.toBeInstanceOf(ProviderError);
    expect(mockBehaviour.imageCalls).toBe(1);
    const rows = await ledger(m);
    expect(rows).toHaveLength(1);
    expect(rows[0].images).toBe(1);
    expect(Number(rows[0].cost_pence)).toBeCloseTo(MOCK_IMAGE_PENCE, 4);
    expect(await reservations(m)).toHaveLength(0);
  });

  it("a request the provider turned away (4xx) is not charged", async () => {
    const m = await createMember();
    const refused = new APICallError({ message: "Bad request", url: "https://example.test", requestBodyValues: {}, statusCode: 400 });
    mockBehaviour.failImage(refused);
    await expect(draw(m)).rejects.toThrow(/not retried/);
    expect(await ledger(m)).toHaveLength(0);
    expect(await reservations(m)).toHaveLength(0);
    expect(imageFailureMayBeBilled(refused)).toBe(false);
    expect(imageFailureMayBeBilled(new APICallError({ message: "Server", url: "https://example.test", requestBodyValues: {}, statusCode: 503 }))).toBe(true);
    expect(imageFailureMayBeBilled(new Error("The operation was aborted due to timeout"))).toBe(true);
  });

  it("generate() sends pictures to a text model for a vision check, through the cap and ledger", async () => {
    const m = await createMember();
    const img = await draw(m);
    const res = await generate({ agent: "imageCheck", userId: m.userId, workspaceId: m.workspaceId, prompt: "Look at this", images: [{ data: img.bytes, mediaType: "image/png" }] });
    expect(res.text).toBe("Mock response");
    expect(mockBehaviour.lastImageCount).toBe(1);
    expect(await ledger(m)).toHaveLength(2);
    expect(await reservations(m)).toHaveLength(0);
  });

  it("the image model is Nano Banana 2.1 at 1K, overridable, and the mock in tests", () => {
    expect(resolveImageModel({})).toEqual({ provider: "google", model: "gemini-nano-banana-2.1", size: "1K" });
    expect(resolveImageModel({ IMAGE_MODEL: "google:gemini-3.1-flash-image" })).toMatchObject({ provider: "google", model: "gemini-3.1-flash-image" });
    expect(resolveImageModel({ MODEL_PROVIDER_OVERRIDE: "mock" })).toMatchObject({ provider: "mock", model: "mock-image" });
    expect(resolveImageModel()).toMatchObject({ provider: "mock" });
    expect(() => resolveImageModel({ IMAGE_MODEL: "nonsense" })).toThrow(/IMAGE_MODEL/);
    expect(imageCostPence("google", "gemini-nano-banana-2.1", "1K", 4)).toBeCloseTo(4 * 0.0336 * 79, 6);
    expect(() => imageCostPence("google", "unknown-model", "1K", 1)).toThrow(/No image price/);
  });
});

describe("S5-1 palette colours in words", () => {
  it("turns the demo palettes into plain colour words", () => {
    expect(paletteWords([
      { name: "Ink", hex: "#14213D" },
      { name: "Quill blue", hex: "#1F4E79" },
      { name: "Gold leaf", hex: "#F2C14E" },
      { name: "Paper", hex: "#F7F5F0" },
      { name: "Sage", hex: "#6B9080" },
    ]).map((c) => c.words)).toEqual(["deep navy blue", "deep blue", "bright golden yellow", "warm off-white", "sage green"]);
    expect(["#3F5B3A", "#B5653A", "#E8EBE4", "#2B2A26", "#4F7A8C"].map(colourWords)).toEqual([
      "deep sage green",
      "burnt orange",
      "warm off-white",
      "charcoal grey",
      "muted petrol blue",
    ]);
  });
  it("names pure colours and neutrals simply, and never returns a hex", () => {
    expect(colourWords("#FF0000")).toBe("bright red");
    expect(colourWords("#000000")).toBe("near black");
    expect(colourWords("#FFFFFF")).toBe("white");
    expect(colourWords("#808080")).toBe("mid grey");
    expect(colourWords("not a colour")).toBe("neutral");
    for (const hex of ["#123456", "#abcdef", "#00ff7f", "#ff00ff"]) expect(colourWords(hex)).not.toMatch(/#|\d/);
  });
});
