import net from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeSql, CONNECT_TIMEOUT_S, IDLE_TIMEOUT_S, keepInstanceUntilIdle, withSql } from "@/lib/db/client";
import { asUser, attemptsFor, isConnectionError } from "@/lib/db/scoped";

// Production, 29 Oct (decision 0016): a pooled connection that closed inside a
// transaction made postgres.js write the transaction's rollback to a null
// socket from a setImmediate (an uncaught TypeError, then the process exited),
// and the same connection's next connect never sent its startup message
// (CONNECT_TIMEOUT). These tests put a small TCP proxy between the pool and
// Postgres so they can drop connections the way Neon's pooler and a suspended
// instance do.

type Pair = { client: net.Socket; server: net.Socket };

/** A Postgres ErrorResponse message (FATAL), as a server refusing a startup sends. */
function fatal(code: string, message: string): Buffer {
  const fields = Buffer.from(`SFATAL\0VFATAL\0C${code}\0M${message}\0\0`);
  const head = Buffer.alloc(5);
  head.write("E", 0);
  head.writeUInt32BE(fields.length + 4, 1);
  return Buffer.concat([head, fields]);
}

class Proxy {
  private server = net.createServer((client) => this.accept(client));
  readonly pairs = new Set<Pair>();
  private refused = new Set<net.Socket>();
  opened = 0;
  /** What new connections get: Postgres, a refusal (an ErrorResponse, then close), or a close. */
  mode: "pipe" | "refuse" | "close" = "pipe";
  constructor(private target: { host: string; port: number }) {}

  async listen(): Promise<number> {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    return (this.server.address() as net.AddressInfo).port;
  }

  private accept(client: net.Socket) {
    this.opened++;
    client.on("error", () => {});
    if (this.mode !== "pipe") {
      this.refused.add(client);
      client.on("close", () => this.refused.delete(client));
    }
    if (this.mode === "close") return void client.end();
    if (this.mode === "refuse") {
      client.once("data", () => client.end(fatal("55000", "not accepting connections")));
      return;
    }
    const server = net.connect(this.target.port, this.target.host);
    const pair = { client, server };
    this.pairs.add(pair);
    client.pipe(server);
    server.pipe(client);
    const drop = () => {
      client.destroy();
      server.destroy();
      this.pairs.delete(pair);
    };
    for (const s of [client, server]) {
      s.on("error", drop);
      s.on("close", drop);
    }
  }

  /** The far end closes cleanly (a FIN), as when the pooler or compute goes away. */
  closeAll() {
    for (const { client, server } of this.pairs) {
      server.destroy();
      client.end();
    }
  }

  /**
   * The connection is dead but the client hasn't heard: as after a suspension.
   * Postgres's side goes now; the client's side is reset when it next writes.
   */
  goStale() {
    for (const { client, server } of this.pairs) {
      server.unpipe(client);
      client.unpipe(server);
      server.removeAllListeners("close");
      server.destroy();
      client.once("data", () => client.resetAndDestroy());
      client.resume();
    }
  }

  async close() {
    for (const s of this.refused) s.destroy();
    for (const { client, server } of this.pairs) {
      client.destroy();
      server.destroy();
    }
    await new Promise((r) => this.server.close(r));
  }
}

describe("a dropped database connection (decision 0016)", () => {
  const realUrl = process.env.DATABASE_URL!;
  const realMax = process.env.DATABASE_POOL_MAX;
  let proxy: Proxy;
  const uncaught: unknown[] = [];
  const onUncaught = (e: unknown) => uncaught.push(e);

  beforeAll(() => {
    process.on("uncaughtException", onUncaught);
  });
  afterAll(() => {
    process.off("uncaughtException", onUncaught);
  });

  beforeEach(async () => {
    await closeSql();
    uncaught.length = 0;
    const url = new URL(realUrl);
    proxy = new Proxy({ host: url.hostname, port: Number(url.port || 5432) });
    url.hostname = "127.0.0.1";
    url.port = String(await proxy.listen());
    process.env.DATABASE_URL = url.toString();
    process.env.DATABASE_POOL_MAX = "1";
  });

  afterEach(async () => {
    await closeSql();
    await proxy.close();
    process.env.DATABASE_URL = realUrl;
    if (realMax === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = realMax;
  });

  const nextTicks = () => new Promise((r) => setTimeout(r, 100));

  it("closed mid-transaction: that request fails cleanly, nothing is thrown outside it, and the next request works at once", async () => {
    const userId = randomUUID();
    let runs = 0;
    const failed = asUser(userId, async (tx) => {
      runs++;
      await tx`select 1`;
      const slow = tx`select pg_sleep(2)`;
      setTimeout(() => proxy.closeAll(), 200);
      await slow;
    });
    await expect(failed).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await nextTicks();
    expect(uncaught).toEqual([]);
    expect(runs).toBe(1); // the caller's work had started, so it is not retried

    const started = Date.now();
    const n = await asUser(userId, async (tx) => (await tx`select 2 as n`)[0].n as number);
    expect(n).toBe(2);
    expect(Date.now() - started).toBeLessThan(CONNECT_TIMEOUT_S * 1000 - 5000);
    await nextTicks();
    expect(uncaught).toEqual([]);
  });

  it("dead while idle (as after a suspension): the request is retried once on a fresh connection", async () => {
    const userId = randomUUID();
    await asUser(userId, async (tx) => tx`select 1`);
    expect(proxy.opened).toBe(1);
    proxy.goStale();

    let runs = 0;
    const n = await asUser(userId, async (tx) => {
      runs++;
      return (await tx`select 3 as n`)[0].n as number;
    });
    expect(n).toBe(3);
    expect(runs).toBe(1);
    expect(proxy.opened).toBe(2);
    await nextTicks();
    expect(uncaught).toEqual([]);
  });

  it("an error from the statement itself is not retried", async () => {
    let runs = 0;
    await expect(
      asUser(randomUUID(), async (tx) => {
        runs++;
        await tx`select 1/0`;
      }),
    ).rejects.toMatchObject({ code: "22012" });
    expect(runs).toBe(1);
  });

  it("every idle connection dead: retried up to the pool's size, and the caller's work runs once", async () => {
    process.env.DATABASE_POOL_MAX = "3";
    const userId = randomUUID();
    await Promise.all([1, 2, 3].map(() => asUser(userId, async (tx) => tx`select pg_sleep(0.1)`)));
    expect(proxy.opened).toBe(3);
    proxy.goStale();

    let runs = 0;
    const n = await asUser(userId, async (tx) => {
      runs++;
      return (await tx`select 4 as n`)[0].n as number;
    });
    expect(n).toBe(4);
    expect(runs).toBe(1);
    expect(proxy.opened).toBe(4);
    await nextTicks();
    expect(uncaught).toEqual([]);
  });

  it("closed mid-transaction, then the next startup is refused: the next request fails at once, with no reconnect loop", async () => {
    const userId = randomUUID();
    const failed = asUser(userId, async (tx) => {
      const slow = tx`select pg_sleep(2)`;
      setTimeout(() => {
        proxy.mode = "refuse";
        proxy.closeAll();
      }, 200);
      await slow;
    });
    await expect(failed).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });

    const started = Date.now();
    const next = asUser(userId, async (tx) => tx`select 1`);
    // Before the fix, the refusal was taken as the dead query's error: this
    // never settled and the pool reconnected in a tight loop.
    await expect(next).rejects.toMatchObject({ code: "55000" });
    expect(Date.now() - started).toBeLessThan(3000);
    const opened = proxy.opened;
    await new Promise((r) => setTimeout(r, 500));
    expect(proxy.opened).toBe(opened);
    expect(uncaught).toEqual([]);
  });

  it("a server that closes during startup fails the request after a bounded number of tries", async () => {
    process.env.DATABASE_POOL_MAX = "2";
    proxy.mode = "close";
    const started = Date.now();
    let runs = 0;
    await expect(
      asUser(randomUUID(), async () => {
        runs++;
      }),
    ).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(runs).toBe(0);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(proxy.opened).toBe(3); // the pool's size, plus one
    await new Promise((r) => setTimeout(r, 500));
    expect(proxy.opened).toBe(3);
  });
});

describe("connection errors", () => {
  it("are told apart from statement errors", () => {
    for (const code of ["CONNECTION_CLOSED", "CONNECT_TIMEOUT", "ECONNRESET", "08006", "57P01", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]) {
      expect(isConnectionError({ code })).toBe(true);
    }
    for (const code of ["22012", "42501", "40001", "CONNECTION_ENDED"]) {
      expect(isConnectionError({ code })).toBe(false);
    }
    expect(isConnectionError(new Error("x"))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });

  it("a dead connection may be retried up to the pool's size, a failed connect once, anything else never", () => {
    expect(attemptsFor({ code: "CONNECTION_CLOSED" }, 5)).toBe(6);
    expect(attemptsFor({ code: "08006" }, 5)).toBe(6);
    expect(attemptsFor({ code: "CONNECT_TIMEOUT" }, 5)).toBe(2);
    expect(attemptsFor({ code: "ENOTFOUND" }, 5)).toBe(2);
    expect(attemptsFor({ code: "22012" }, 5)).toBe(1);
  });
});

describe("keepInstanceUntilIdle", () => {
  const key = Symbol.for("@vercel/request-context");
  const g = globalThis as unknown as Record<symbol, unknown>;
  afterEach(() => {
    delete g[key];
    vi.useRealTimers();
  });

  it("holds the Vercel instance until the pool's idle connections have closed, one wait at a time", async () => {
    vi.useFakeTimers();
    const waits: Promise<unknown>[] = [];
    g[key] = { get: () => ({ waitUntil: (p: Promise<unknown>) => waits.push(p) }) };
    const settled: number[] = [];

    keepInstanceUntilIdle();
    void waits[0].then(() => settled.push(0));
    await vi.advanceTimersByTimeAsync(1000);
    keepInstanceUntilIdle(); // a second use releases the first wait and starts another
    void waits[1].then(() => settled.push(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toEqual([0]);

    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_S * 1000);
    expect(settled).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toEqual([0, 1]);
  });

  it("does nothing outside a Vercel request", () => {
    expect(() => keepInstanceUntilIdle()).not.toThrow();
  });

  it("starts the wait after a bare statement has settled, not before", async () => {
    const waits: number[] = [];
    g[key] = { get: () => ({ waitUntil: () => waits.push(Date.now()) }) };
    let finished = 0;
    await withSql(async (sql) => {
      await sql`select pg_sleep(0.3)`;
      finished = Date.now();
    });
    expect(waits.at(-1)!).toBeGreaterThanOrEqual(finished);
  });
});
