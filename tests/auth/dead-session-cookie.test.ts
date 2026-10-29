// Sprint 6 review: a cs_session cookie that no session matches (signed out
// elsewhere, expired, revoked or made up) is cleared instead of renewed, so the
// visitor is treated as having no cookie: / shows the welcome page and app
// pages ask them to sign in. The proxy can't query the database, so the
// signed-in pages (requireMember) send such a visitor to /signin/ended, which
// clears the cookie only if it really is dead.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
const requestHeaders = new Map<string, string>();
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined), has: (name: string) => jar.has(name) }),
  headers: async () => ({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

const { NextRequest } = await import("next/server");
const { GET } = await import("@/app/signin/ended/route");
const { proxy, PATH_HEADER, SESSION_ENDED_PATH } = await import("@/proxy");
const { requireMember } = await import("@/lib/auth/session");
const { createSession, endSessionToken } = await import("@/lib/auth/session-store");
const { closeSql } = await import("@/lib/db/client");
const { createUser, truncateAll } = await import("../helpers/db");

const OWNER = "owner@example.test";
const ORIGIN = "http://localhost:3000";
const DEAD = "A".repeat(43);
let ownerId: string;

const ended = (cookie: string | null, query = "") =>
  GET(new NextRequest(`${ORIGIN}/signin/ended${query}`, { headers: cookie === null ? {} : { cookie: `cs_session=${cookie}` } }));
const clears = (res: Response) => /^cs_session=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(res.headers.get("set-cookie") ?? "");

async function memberAt(path: string | null, cookie: string | null) {
  jar.clear();
  requestHeaders.clear();
  if (cookie !== null) jar.set("cs_session", cookie);
  if (path !== null) requestHeaders.set(PATH_HEADER, path);
  try {
    return { member: await requireMember() };
  } catch (e) {
    if (e instanceof Redirected) return { to: e.to };
    throw e;
  }
}

describe("dead session cookies (Sprint 6 review)", () => {
  beforeAll(async () => {
    process.env.OWNER_EMAIL = OWNER;
    process.env.ALLOWED_EMAILS = OWNER;
    await truncateAll();
    ownerId = await createUser(OWNER);
  });
  beforeEach(() => {
    jar.clear();
    requestHeaders.clear();
  });
  afterAll(async () => {
    delete process.env.OWNER_EMAIL;
    delete process.env.ALLOWED_EMAILS;
    await closeSql();
  });

  it("requireMember: a live session is a member", async () => {
    const { token } = await createSession(ownerId);
    const r = await memberAt("/brands", token);
    expect(r.member).toMatchObject({ userId: ownerId, email: OWNER });
  });

  it("requireMember: no cookie goes to sign-in, as before", async () => {
    expect(await memberAt("/brands", null)).toEqual({ to: "/signin" });
  });

  it("requireMember: a signed-out cookie is sent to be cleared; from / it ends on the welcome page", async () => {
    const { token } = await createSession(ownerId);
    await endSessionToken(token);
    expect(await memberAt("/brands", token)).toEqual({ to: SESSION_ENDED_PATH });
    expect(await memberAt("/", token)).toEqual({ to: `${SESSION_ENDED_PATH}?to=welcome` });
    // A request the proxy didn't see (no path) is treated as an app page.
    expect(await memberAt(null, token)).toEqual({ to: SESSION_ENDED_PATH });
  });

  it("requireMember (hostile): a made-up or malformed cookie is sent to be cleared too", async () => {
    expect(await memberAt("/runs", DEAD)).toEqual({ to: SESSION_ENDED_PATH });
    expect(await memberAt("/runs", "'; drop table auth.sessions; --")).toEqual({ to: SESSION_ENDED_PATH });
  });

  it("the route clears a signed-out cookie and sends the visitor to sign-in, or to the welcome page from /", async () => {
    const { token } = await createSession(ownerId);
    await endSessionToken(token);
    const res = await ended(token);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/signin`);
    expect(clears(res)).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const home = await ended(token, "?to=welcome");
    expect(home.headers.get("location")).toBe(`${ORIGIN}/welcome`);
    expect(clears(home)).toBe(true);
  });

  it("the route clears the cookie of someone who has lost access, even though their session row is still there", async () => {
    const outsider = await createUser("no-longer-invited@example.test");
    const { token } = await createSession(outsider);
    const res = await ended(token);
    expect(clears(res)).toBe(true);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/signin`);
  });

  it("the route (hostile): a link from another site can't sign out a live session", async () => {
    const { token } = await createSession(ownerId);
    const res = await ended(token, "?to=welcome");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await memberAt("/", token)).member?.userId).toBe(ownerId);
  });

  it("the route with no cookie sets nothing and ignores any other `to`", async () => {
    const res = await ended(null, "?to=https://elsewhere.example");
    expect(res.headers.get("location")).toBe(`${ORIGIN}/signin`);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("the proxy renews a session cookie on GET, but never on the route that clears it", async () => {
    const at = (path: string) => proxy(new NextRequest(`${ORIGIN}${path}`, { headers: { cookie: `cs_session=${DEAD}` } }));
    expect(at("/brands").headers.get("set-cookie")).toMatch(/^cs_session=A{43};/);
    expect(at(SESSION_ENDED_PATH).headers.get("set-cookie")).toBeNull();
  });

  it("the proxy (hostile): passes on the path itself, overwriting one the client sent", () => {
    const res = proxy(new NextRequest(`${ORIGIN}/brands`, { headers: { [PATH_HEADER]: "/" } }));
    expect(res.headers.get(`x-middleware-request-${PATH_HEADER}`)).toBe("/brands");
  });
});
