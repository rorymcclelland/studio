// Sprint 6 review: production's public health check doesn't name its database
// host; previews and local work still do (N-5 #1). The after-deploy Action
// reads only `commit` and `inngestFunctions`.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("@/lib/db/client", () => ({ getSql: () => async () => [{ "?column?": 1 }] }));
vi.mock("@/inngest/functions", () => ({ functions: [{ id: () => "campaign-studio-agent-run" }] }));

const { GET } = await import("@/app/api/health/route");
const HOST = "ep-quiet-sky-123456-pooler.eu-west-2.aws.neon.tech";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function health(env: Record<string, string>) {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("DATABASE_URL", `postgres://studio_owner:secret-password@${HOST}/studio`);
    vi.stubEnv("VERCEL_ENV", "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const res = await GET();
    return { status: res.status, text: await res.clone().text(), body: await res.json() };
  }

  it("in production: ok, the commit and the functions, but no database host", async () => {
    const r = await health({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "a33b51b9e76931f65d7edb4759c228a2afdcaafe" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, environment: "production", commit: "a33b51b", inngestFunctions: ["campaign-studio-agent-run"] });
    expect(r.body).not.toHaveProperty("databaseHost");
    expect(r.text).not.toContain("neon.tech");
    expect(r.text).not.toContain("secret-password");
  });

  it("on a preview and locally: names the database host, never the password", async () => {
    for (const env of [{ VERCEL_ENV: "preview" }, {}]) {
      const r = await health(env);
      expect(r.body.databaseHost).toBe(HOST);
      expect(r.text).not.toContain("secret-password");
    }
  });
});
