// N-6: the production data copy (scripts/copy-data.mjs) and its check
// (scripts/check-copy.mjs), locally. The source is built like Supabase's
// production: a Supabase-style auth schema with many more columns, the first 23
// migration files, no schema_migrations ledger. The target is built like Neon's
// production branch: all the files, owned by a role that is not a superuser,
// and the copy runs as that role.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyOrder } from "../../scripts/copy-data.mjs";

const base = new URL(process.env.DATABASE_URL ?? "postgres://postgres@localhost:54329/campaign_studio_test");
const MIGRATIONS = join(process.cwd(), "db/migrations");
const LAST_SUPABASE_FILE = "20261028000005_sprint5_review_fixes.sql";
const made: string[] = [];
const madeRoles: string[] = [];
const dirs: string[] = [];

function urlFor(db: string, user = base.username || "postgres"): string {
  const u = new URL(base.toString());
  u.pathname = `/${db}`;
  u.username = user;
  return u.toString();
}

async function withDb<T>(url: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, { onnotice: () => {}, max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

const admin = <T>(fn: (sql: postgres.Sql) => Promise<T>) => withDb(urlFor("postgres"), fn);

async function freshDb(owner?: string): Promise<string> {
  const name = `cs_copy_${randomBytes(4).toString("hex")}`;
  await admin((sql) => sql.unsafe(`create database "${name}"${owner ? ` owner "${owner}"` : ""}`));
  made.push(name);
  return name;
}

function run(script: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const migrate = (url: string, dir?: string) => {
  const r = run("scripts/db-migrate.mjs", ["--url", "COPY_TEST_URL", ...(dir ? ["--dir", dir] : [])], { COPY_TEST_URL: url });
  expect(r.code, r.err).toBe(0);
};

const copy = (from: string, to: string, extra: string[] = []) =>
  run("scripts/copy-data.mjs", ["--from", "COPY_FROM", "--to", "COPY_TO", ...extra], { COPY_FROM: from, COPY_TO: to });
const check = (a: string, b: string) => run("scripts/check-copy.mjs", ["--a", "CHECK_A", "--b", "CHECK_B"], { CHECK_A: a, CHECK_B: b });

/** A fixed uuid whose sort position is set by `tail` (so a child can sort before its parent). */
const uid = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const ID = {
  rory: uid("a1"),
  guest: uid("a2"),
  supabaseOnly: uid("a3"),
  w1: uid("b1"),
  w2: uid("b2"),
  brand: uid("c1"),
  brand2: uid("c2"),
  product: uid("c3"),
  customer: uid("c4"),
  order: uid("c5"),
  line: uid("c6"),
  item1: uid("d1"),
  item2: uid("d2"),
  item3: uid("d3"),
  edge: uid("d4"),
  runBrief: uid("e1"),
  runPersona: uid("e2"),
  runPlan: uid("e3"),
  runCopy: uid("e4"),
  runCreative: uid("e5"),
  runTagline: uid("e6"),
  step: uid("e7"),
  campaign: uid("f1"),
  logo: uid("1a"),
  image1: uid("1b"),
  image2: uid("1c"),
  image3: uid("1d"),
  // Each copy set and variant sorts before the one it is based on, so a copy in
  // primary-key order would break the self-references.
  cs1: uid("2f"),
  cs2: uid("2e"),
  cs3: uid("2d"),
  cs4: uid("2c"),
  av1: uid("3f"),
  av2: uid("3e"),
  av3: uid("3d"),
  invite: uid("4a"),
};
const IMAGE_BYTES = { image1: randomBytes(40_000), image2: randomBytes(40_000), image3: randomBytes(40_000) };
const ROW_SECRET_EMAIL = "rory.copytest@example.test";

/** Supabase's production as N-6 finds it: Supabase's auth, the files up to Sprint 5, no ledger. */
async function buildSource(): Promise<string> {
  const authAdmin = `cs_authadm_${randomBytes(3).toString("hex")}`;
  await admin((sql) => sql.unsafe(`create role "${authAdmin}" nologin`));
  madeRoles.push(authAdmin);
  const db = await freshDb();
  const url = urlFor(db);
  await withDb(url, (su) =>
    su.unsafe(`
      create schema auth authorization "${authAdmin}";
      create table auth.users (
        instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255), email varchar(255),
        encrypted_password varchar(255), email_confirmed_at timestamptz, raw_app_meta_data jsonb,
        raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz, is_anonymous boolean not null default false);
      create unique index users_email_partial_key on auth.users (email);
      alter table auth.users owner to "${authAdmin}";
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select 'x' $$;
      alter function auth.uid() owner to "${authAdmin}";
      alter function auth.role() owner to "${authAdmin}";
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid(), auth.role() to anon, authenticated;
      create schema storage;
      create table storage.objects (id uuid primary key, name text);
      insert into storage.objects values (gen_random_uuid(), 'never copied');
    `),
  );
  const supabaseEra = mkdtempSync(join(tmpdir(), "cs-copy-"));
  dirs.push(supabaseEra);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f <= LAST_SUPABASE_FILE)) copyFileSync(join(MIGRATIONS, f), join(supabaseEra, f));
  expect(readdirSync(supabaseEra)).toHaveLength(23);
  migrate(url, supabaseEra);
  await withDb(url, async (sql) => {
    await sql`drop table public.schema_migrations`;
    await seed(sql);
  });
  return url;
}

/** Realistic rows in every table, made in the order the app makes them, with the guards on. */
async function seed(sql: postgres.Sql) {
  await sql`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, created_at, updated_at)
    values (${uid("0")}, ${ID.rory}, 'authenticated', 'authenticated', ${ROW_SECRET_EMAIL}, 'x', ${sql.json({ provider: "email" })}, '2026-10-25 09:00:00.123456+00', now()),
           (${uid("0")}, ${ID.guest}, 'authenticated', 'authenticated', 'guest@example.test', 'y', ${sql.json({})}, '2026-10-27 15:30:00.654321+01', now()),
           (${uid("0")}, ${ID.supabaseOnly}, 'authenticated', 'authenticated', null, null, ${sql.json({})}, now(), now())`;
  await sql`insert into public.workspaces (id, name, created_by) values (${ID.w1}, 'Rory''s workspace', ${ID.rory}), (${ID.w2}, 'Guest', ${ID.guest})`;
  await sql`insert into public.workspace_members (workspace_id, user_id) values (${ID.w1}, ${ID.rory}), (${ID.w2}, ${ID.guest})`;
  await sql`insert into public.profiles (user_id, display_name) values (${ID.rory}, 'Rory'), (${ID.guest}, null)`;
  await sql.unsafe(
    `insert into public.brands (id, workspace_id, name, slug, tone_words, palette, legal_lines, is_simulated, created_by, data_as_of)
     values ($1, $2, 'Fernhollow Outfitters', 'fernhollow', '{"warm","say \\"hi\\"","a,b"}',
             '[{"name":"Moss","hex":"#2F4F2F"}]', '{"T&Cs apply."}', true, $3, '2026-10-01 00:00:00.000001+00'),
            ($4, $5, 'Quillmere', 'quillmere', '{}', '[]', '{}', true, $6, null)`,
    [ID.brand, ID.w1, ID.rory, ID.brand2, ID.w2, ID.guest],
  );
  await sql`insert into public.products (id, workspace_id, brand_id, name, price_pence, launched_on) values (${ID.product}, ${ID.w1}, ${ID.brand}, 'Trail jacket', 12999, '2026-03-01')`;
  await sql`insert into public.customers (id, workspace_id, brand_id, external_ref, region, marketing_consent) values (${ID.customer}, ${ID.w1}, ${ID.brand}, 'C-0001', 'North', true)`;
  await sql`insert into public.orders (id, workspace_id, brand_id, customer_id, ordered_at, channel) values (${ID.order}, ${ID.w1}, ${ID.brand}, ${ID.customer}, now(), 'web')`;
  await sql`insert into public.order_lines (id, workspace_id, order_id, product_id, quantity, price_pence) values (${ID.line}, ${ID.w1}, ${ID.order}, ${ID.product}, 2, 12999)`;
  await sql.unsafe(
    `insert into public.context_items (id, workspace_id, brand_id, kind, title, body, source, source_ref, tags, meta) values
       ($1, $4, $5, 'brand_voice', 'Voice', 'Warm and plain.', 'kit', 'voice', '{}', '{}'),
       ($2, $4, $5, 'insight', 'Lapsed buyers', 'Came back for rain gear.', 'analysis', null, '{"rain"}', '{"big": 12345678901234567890.123456789}'),
       ($3, $6, $7, 'product', 'Notebook', '', 'catalogue', 'product:1', '{}', '{}')`,
    [ID.item1, ID.item2, ID.item3, ID.w1, ID.brand, ID.w2, ID.brand2],
  );
  await sql`insert into public.context_edges (id, workspace_id, from_item, to_item, relation) values (${ID.edge}, ${ID.w1}, ${ID.item2}, ${ID.item1}, 'supports')`;

  const runs = [
    [ID.runBrief, "brief", "completed"],
    [ID.runPersona, "persona", "completed"],
    [ID.runPlan, "test-plan", "completed"],
    [ID.runCopy, "copy", "completed"],
    [ID.runCreative, "creative", "completed"],
    [ID.runTagline, "tagline", "awaiting_approval"],
  ];
  for (const [id, agent, status] of runs) {
    await sql`insert into public.agent_runs (id, workspace_id, agent, agent_version, status, input, output, created_by, brand_id, label, completed_at)
      values (${id}, ${ID.w1}, ${agent}, 1, ${status}::public.run_status, ${sql.json({ campaignId: ID.campaign, mode: "make" })},
              ${status === "completed" ? sql.json({ ok: true, n: 1.5 }) : null}, ${ID.rory}, ${ID.brand}, ${`Fernhollow: ${agent}`},
              ${status === "completed" ? sql`now()` : null})`;
  }
  await sql`insert into public.agent_steps (id, run_id, workspace_id, seq, name, kind, status, provider, model, input_tokens, output_tokens, cost_pence, attempt_log)
    values (${ID.step}, ${ID.runCopy}, ${ID.w1}, 1, 'write', 'model', 'succeeded', 'anthropic', 'claude', 1200, 340, 0.1234, ${sql.json([{ attempt: 1 }])})`;
  for (let i = 0; i < 4; i++) {
    await sql`insert into public.usage_ledger (workspace_id, run_id, step_id, agent, provider, model, input_tokens, output_tokens, cost_pence, search_requests, images)
      values (${ID.w1}, ${ID.runCopy}, ${i === 0 ? ID.step : null}, 'copy', ${i === 3 ? "mock" : "anthropic"}, 'claude', 100, 20, ${`0.${i}123`}, ${i}, ${i === 2 ? 3 : 0})`;
  }
  await sql`delete from public.usage_ledger where id = 2`; // a gap, as a real ledger has none but ids need not be dense

  // A campaign with two brief versions, signed off.
  await sql`insert into public.campaigns (id, workspace_id, brand_id, objective, status, current_version, run_id, created_by)
    values (${ID.campaign}, ${ID.w1}, ${ID.brand}, 'Win back lapsed buyers before winter', 'drafting', 1, ${ID.runBrief}, ${ID.rory})`;
  await sql`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, run_id, created_by)
    values (${ID.w1}, ${ID.campaign}, 1, ${sql.json({ objective: "Win back", channels: ["paid social"] })}, 'agent', ${ID.runBrief}, ${ID.rory})`;
  await sql`update public.campaigns set current_version = 2, status = 'draft' where id = ${ID.campaign}`;
  await sql`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, note, created_by)
    values (${ID.w1}, ${ID.campaign}, 2, ${sql.json({ objective: "Win back lapsed buyers", channels: ["paid social", "display"] })}, 'person', 'Tightened', ${ID.rory})`;
  const [signoff] = await sql`insert into public.approvals (workspace_id, kind, campaign_id, brief_version, question, options, expires_at)
    values (${ID.w1}, 'brief_signoff', ${ID.campaign}, 2, 'Sign off?', ${sql.json([])}, now() + interval '7 days') returning id`;
  await sql`update public.approvals set status = 'approved', decided_by = ${ID.rory}, decided_at = now() where id = ${signoff.id}`;
  await sql`update public.campaigns set status = 'approved', approved_version = 2, approved_at = now(), approved_by = ${ID.rory} where id = ${ID.campaign}`;
  await sql`insert into public.approvals (run_id, workspace_id, question, options, expires_at)
    values (${ID.runTagline}, ${ID.w1}, 'Pick a tagline', ${sql.json(["One", "Two", "Three"])}, now() + interval '1 day')`;
  await sql`insert into public.persona_reviews (workspace_id, campaign_id, brief_version, run_id, review, created_by)
    values (${ID.w1}, ${ID.campaign}, 2, ${ID.runPersona}, ${sql.json({ personas: [{ name: "Hiker" }] })}, ${ID.rory})`;
  await sql`insert into public.test_plans (workspace_id, campaign_id, brief_version, run_id, plan, created_by)
    values (${ID.w1}, ${ID.campaign}, 2, ${ID.runPlan}, ${sql.json({ cells: 2 })}, ${ID.rory})`;
  await sql`insert into public.invites (id, email, token_hash, created_by, expires_at, used_at, used_by)
    values (${ID.invite}, 'guest@example.test', ${"a".repeat(64)}, ${ID.rory}, now() + interval '7 days', now(), ${ID.guest})`;
  await sql`insert into public.spend_reservations (workspace_id, run_id, pence) values (${ID.w1}, ${ID.runCreative}, 4.5)`;

  // A PNG logo for the brand (brands.logo_asset_id and assets.brand_id make a cycle), and pictures.
  await sql`insert into public.assets (id, workspace_id, kind, brand_id, mime, width, height, bytes, sha256, created_by, created_by_kind)
    values (${ID.logo}, ${ID.w1}, 'logo', ${ID.brand}, 'image/png', 1, 1, ${PNG}, ${sha(PNG)}, ${ID.rory}, 'person')`;
  await sql`update public.brands set logo_asset_id = ${ID.logo} where id = ${ID.brand}`;
  for (const key of ["image1", "image2", "image3"] as const) {
    const bytes = IMAGE_BYTES[key];
    await sql`insert into public.assets (id, workspace_id, kind, brand_id, campaign_id, run_id, mime, width, height, bytes, sha256, simulated, meta, created_by, created_by_kind)
      values (${ID[key]}, ${ID.w1}, 'image', ${ID.brand}, ${ID.campaign}, ${ID.runCreative}, 'image/webp', 1024, 1024, ${bytes}, ${sha(bytes)},
              true, ${sql.json({ idea: key, prompt: "a hillside in rain" })}, ${ID.rory}, 'agent')`;
  }

  // Copy sets: an agent's set, a hand edit of it, an edit of that edit, and a display set.
  const set = (headline: string) => sql.json({ headline, body: "Rain-ready." });
  await sql`insert into public.copy_sets (id, workspace_id, campaign_id, brief_version, run_id, channel, segment_ref, segment_title, set, legal_lines, source, created_by)
    values (${ID.cs1}, ${ID.w1}, ${ID.campaign}, 2, ${ID.runCopy}, 'paid social', ${ID.item2}, 'Lapsed buyers', ${set("Back for the rain")}, '{"T&Cs apply."}', 'agent', ${ID.rory})`;
  await sql`insert into public.copy_sets (id, workspace_id, campaign_id, brief_version, channel, segment_title, set, source, based_on, created_by)
    values (${ID.cs2}, ${ID.w1}, ${ID.campaign}, 2, 'paid social', 'Lapsed buyers', ${set("Made for the rain")}, 'person', ${ID.cs1}, ${ID.rory})`;
  await sql`insert into public.copy_sets (id, workspace_id, campaign_id, brief_version, channel, segment_title, set, source, based_on, created_by)
    values (${ID.cs3}, ${ID.w1}, ${ID.campaign}, 2, 'paid social', 'Lapsed buyers', ${set("Made for rain")}, 'person', ${ID.cs2}, ${ID.rory})`;
  await sql`update public.copy_sets set discarded_at = now() where id = ${ID.cs1}`;
  await sql`insert into public.copy_sets (id, workspace_id, campaign_id, brief_version, run_id, channel, segment_title, set, source, created_by)
    values (${ID.cs4}, ${ID.w1}, ${ID.campaign}, 2, ${ID.runCopy}, 'display', 'Everyone', ${set("Rain or shine")}, 'agent', ${ID.rory})`;

  // Ad variants: composed, then new words based on it (the old one discarded), and a picked display ad.
  const kit = sql.json({ palette: [{ name: "Moss", hex: "#2F4F2F" }], logo: { asset: ID.logo } });
  const checks = sql.json({ contrast: 7.1, fits: true });
  await sql`insert into public.ad_variants (id, workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, run_id, created_by)
    values (${ID.av1}, ${ID.w1}, ${ID.campaign}, 2, ${ID.image1}, ${ID.cs1}, 'full-bleed', ${checks}, ${kit}, 'composed', ${ID.runCreative}, ${ID.rory})`;
  await sql`insert into public.ad_variants (id, workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, based_on, created_by)
    values (${ID.av2}, ${ID.w1}, ${ID.campaign}, 2, ${ID.image1}, ${ID.cs2}, 'split', ${checks}, ${kit}, 'new words', ${ID.av1}, ${ID.rory})`;
  await sql`update public.ad_variants set discarded_at = now() where id = ${ID.av1}`;
  await sql`insert into public.ad_variants (id, workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, run_id, picked_at, created_by)
    values (${ID.av3}, ${ID.w1}, ${ID.campaign}, 2, ${ID.image2}, ${ID.cs4}, 'card', ${checks}, ${kit}, 'composed', ${ID.runCreative}, now(), ${ID.rory})`;
}

/** Neon's production branch: every file, owned by a role that is not a superuser. Returns that role's URL. */
async function buildTarget(): Promise<{ url: string; db: string; owner: string }> {
  const owner = `cs_owner_${randomBytes(3).toString("hex")}`;
  await admin(async (sql) => {
    await sql.unsafe(`create role "${owner}" login nosuperuser createdb createrole`);
    await sql.unsafe(`grant anon, authenticated to "${owner}" with admin true, inherit false, set false`);
  });
  madeRoles.push(owner);
  const db = await freshDb(owner);
  const url = urlFor(db, owner);
  migrate(url);
  return { url, db, owner };
}

const PUBLIC_TABLES = `select c.relname::text as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'schema_migrations' order by 1`;

async function rowCounts(url: string): Promise<Record<string, number>> {
  return withDb(url, async (sql) => {
    const out: Record<string, number> = {};
    const [{ n }] = await sql`select count(*)::int as n from auth.users`;
    out["auth.users"] = n;
    for (const t of await sql.unsafe(PUBLIC_TABLES)) {
      const [r] = await sql.unsafe(`select count(*)::int as n from public."${t.name}"`);
      out[`public.${t.name}`] = r.n;
    }
    return out;
  });
}

const userTriggerStates = (url: string) =>
  withDb(url, (sql) => sql`select c.relname::text as rel, g.tgname::text as name, g.tgenabled::text as state
    from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not g.tgisinternal and n.nspname = 'public' order by 1, 2`);

let source = "";
let target = { url: "", db: "", owner: "" };
let firstCopy = { code: 0 as number | null, out: "", err: "" };

beforeAll(async () => {
  source = await buildSource();
  target = await buildTarget();
  // Small batches, so every table is read and written in several rounds.
  firstCopy = copy(source, target.url, ["--batch", "2"]);
}, 180_000);

afterAll(async () => {
  await admin(async (sql) => {
    for (const db of made) await sql.unsafe(`drop database if exists "${db}" with (force)`);
    for (const role of madeRoles) await sql.unsafe(`drop role if exists "${role}"`).catch(() => {});
  });
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("N-6 copy into an empty Neon-like target, as its non-superuser owner", () => {
  it("copies every row and the check says the copy matches", async () => {
    expect(firstCopy.code, firstCopy.err).toBe(0);
    const counts = await rowCounts(source);
    expect(await rowCounts(target.url)).toEqual(counts);
    // Every table took part: the seed touches all of them.
    for (const [table, n] of Object.entries(counts)) expect(n, table).toBeGreaterThan(0);
    for (const [table, n] of Object.entries(counts)) expect(firstCopy.out).toContain(`${table}: ${n} rows`);
    // The one cycle (brands.logo_asset_id and assets.brand_id) is the only column copied empty.
    expect(firstCopy.out.match(/copied empty/g), firstCopy.out).toHaveLength(1);
    expect(firstCopy.out).toMatch(/public\.brands\.logo_asset_id: copied empty, then filled in after every table \(breaks the cycle through brands_logo_asset_fk\)/);
    expect(firstCopy.out).toContain("public.brands.logo_asset_id: filled in on 1 rows");
    expect(firstCopy.out).toMatch(/public\.copy_sets: rows ordered so each based_on parent comes first/);
    expect(firstCopy.out).toMatch(/public\.ad_variants: rows ordered so each based_on parent comes first/);

    const c = check(source, target.url);
    expect(c.code, c.out + c.err).toBe(0);
    expect(c.out).toMatch(/^Copy matches \(\d+ tables, \d+ rows, 4 assets\)/);
  });

  it("prints counts, never row contents", () => {
    const all = firstCopy.out + firstCopy.err;
    expect(all).not.toContain(ROW_SECRET_EMAIL);
    expect(all).not.toContain("Fernhollow");
    expect(all).not.toContain("postgres://");
  });

  it("keeps every id, the Supabase users' three columns and nothing of Supabase's other schemas", async () => {
    const ids = (url: string) =>
      withDb(url, async (sql) => ({
        users: await sql`select id, email::text as email, created_at::text as created from auth.users order by id`,
        copySets: await sql`select id, based_on from public.copy_sets order by id`,
        variants: await sql`select id, based_on from public.ad_variants order by id`,
        ledger: (await sql`select id::int as id from public.usage_ledger order by id`).map((r) => r.id),
        logo: (await sql`select logo_asset_id from public.brands where id = ${ID.brand}`)[0].logo_asset_id,
        approvals: await sql`select id from public.approvals order by id`,
      }));
    const a = await ids(source);
    const b = await ids(target.url);
    expect(b).toEqual(a);
    expect(b.ledger).toEqual([1, 3, 4]);
    expect(b.logo).toBe(ID.logo);
    expect(b.users.find((u) => u.id === ID.rory)?.created).toBe("2026-10-25 09:00:00.123456+00");
    await withDb(target.url, async (sql) => {
      const [{ s }] = await sql`select to_regnamespace('storage') as s`;
      expect(s).toBeNull();
      // The generated search column was computed by the target.
      const hits = await sql`select id from public.context_items where search @@ to_tsquery('english', 'rain')`;
      expect(hits.map((h) => h.id)).toEqual([ID.item2]);
      const [big] = await sql`select meta::text as m from public.context_items where id = ${ID.item2}`;
      expect(big.m).toContain("12345678901234567890.123456789");
    });
  });

  it("enables every trigger again and the ledger's sequence continues above the highest id", async () => {
    const states = await userTriggerStates(target.url);
    expect(states.length).toBeGreaterThanOrEqual(14);
    expect(states.filter((s) => s.state !== "O")).toEqual([]);
    const names = states.map((s) => s.name);
    for (const t of ["agent_runs_guard", "assets_guard", "copy_sets_guard", "ad_variants_guard", "approvals_guard",
      "brief_versions_in_order", "ad_variants_parts", "brands_logo_asset_check", "campaigns_guard", "brands_guard"])
      expect(names).toContain(t);
  });

  it("new writes go through the guards as before", async () => {
    const t = await buildTarget();
    expect(copy(source, t.url).code).toBe(0);
    await withDb(t.url, async (sql) => {
      const [l] = await sql`insert into public.usage_ledger (workspace_id, agent, provider, model, input_tokens, output_tokens, cost_pence)
        values (${ID.w1}, 'copy', 'anthropic', 'claude', 1, 1, 0.01) returning id::int as id`;
      expect(l.id).toBe(5);

      await expect(
        sql`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
          values (${ID.w1}, ${ID.campaign}, 3, ${sql.json({})}, 'person', ${ID.rory})`,
      ).rejects.toThrow(/must be the campaign's current version/);
      await sql`update public.campaigns set current_version = 3, status = 'draft' where id = ${ID.campaign}`;
      await sql`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
        values (${ID.w1}, ${ID.campaign}, 3, ${sql.json({})}, 'person', ${ID.rory})`;

      await expect(sql`update public.assets set bytes = '\\x00' where id = ${ID.image1}`).rejects.toThrow(/An asset cannot be changed/);
      await expect(sql`update public.agent_runs set output = ${sql.json({})} where id = ${ID.runBrief}`).rejects.toThrow(/finished run's output/);

      const kit = sql.json({ palette: [] });
      await expect(
        sql`insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, created_by)
          values (${ID.w1}, ${ID.campaign}, 2, ${ID.logo}, ${ID.cs4}, 'card', ${kit}, ${kit}, 'composed', ${ID.rory})`,
      ).rejects.toThrow(/picture must be an image/);
      await sql`insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, created_by)
        values (${ID.w1}, ${ID.campaign}, 2, ${ID.image3}, ${ID.cs4}, 'card', ${kit}, ${kit}, 'composed', ${ID.rory})`;
    });
  });
});

describe("N-6 copy refusals and failures", () => {
  it("refuses a target that already holds rows", async () => {
    const before = await rowCounts(target.url);
    const r = copy(source, target.url);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Refusing to copy: the target already holds rows in auth\.users, .*public\.brands/);
    expect(await rowCounts(target.url)).toEqual(before);
  });

  it("refuses a target whose migrations ledger is short of db/migrations, naming what is missing", async () => {
    const db = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), "cs-copy-"));
    dirs.push(dir);
    for (const f of readdirSync(MIGRATIONS).filter((f) => f <= LAST_SUPABASE_FILE)) copyFileSync(join(MIGRATIONS, f), join(dir, f));
    migrate(urlFor(db), dir);
    const r = copy(source, urlFor(db));
    expect(r.code).toBe(1);
    expect(r.err).toContain("20261029000001_sessions_and_sign_in_tokens.sql");
  });

  it("refuses when a column is on one side only, naming it", async () => {
    const t = await buildTarget();
    await withDb(t.url, (sql) => sql`alter table public.invites add column extra text`);
    const r = copy(source, t.url);
    expect(r.code).toBe(1);
    expect(r.err).toContain("column public.invites.extra is on the target but not the source");
  });

  it("a failure part-way leaves the target empty and its triggers enabled", async () => {
    const t = await buildTarget();
    // ad_variants is one of the last tables copied; this makes its rows fail there.
    await withDb(t.url, (sql) => sql`alter table public.ad_variants add constraint copy_test_fail check (origin = 'edited words') not valid`);
    const r = copy(source, t.url);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Copy failed and was rolled back: .*copy_test_fail/);
    expect(r.err).toContain("Nothing was copied");
    expect(r.out).toContain("public.copy_sets:"); // it got that far
    expect(r.err + r.out).not.toContain(ROW_SECRET_EMAIL);
    const counts = await rowCounts(t.url);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect((await userTriggerStates(t.url)).filter((s) => s.state !== "O")).toEqual([]);
    await withDb(t.url, async (sql) => {
      const [s] = await sql`select last_value::int as v, is_called from public.usage_ledger_id_seq`;
      expect(s).toEqual({ v: 1, is_called: false });
    });
  });

  it("the check reports a changed asset byte and a missing row", async () => {
    const t = await buildTarget();
    expect(copy(source, t.url).code).toBe(0);
    expect(check(source, t.url).code).toBe(0);
    await withDb(urlFor(t.db), async (su) => {
      await su`alter table public.assets disable trigger assets_guard`;
      await su`update public.assets set bytes = overlay(bytes placing '\\xff'::bytea from 100 for 1) where id = ${ID.image2}`;
      await su`alter table public.assets enable trigger assets_guard`;
      await su`delete from public.context_edges where id = ${ID.edge}`;
    });
    const r = check(source, t.url);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`asset ${ID.image2} on CHECK_B: its bytes don't match its stored sha256`);
    expect(r.out).toContain(`asset ${ID.image2}: sha256 differs between CHECK_A and CHECK_B`);
    expect(r.out).toContain("table public.assets: same 4 rows counted, but their values differ");
    expect(r.out).toContain("table public.context_edges: 1 rows on CHECK_A, 0 on CHECK_B");
    expect(r.out).not.toContain("Copy matches");
  });

  it("the check compares auth.users's created_at as well as id and email", async () => {
    const t = await buildTarget();
    expect(copy(source, t.url).code).toBe(0);
    expect(check(source, t.url).code).toBe(0);
    await withDb(urlFor(t.db), (su) => su`update auth.users set created_at = created_at + interval '1 microsecond' where id = ${ID.guest}`);
    const r = check(source, t.url);
    expect(r.code).toBe(1);
    expect(r.out).toContain("table auth.users: same 3 rows counted, but their values differ");
  });

  it("refuses a source whose auth.users emails aren't lower-case and trimmed, giving only a count; the check reports it too", async () => {
    const mixed = "Guest@Example.TEST ";
    await withDb(source, (sql) => sql`update auth.users set email = ${mixed} where id = ${ID.guest}`);
    try {
      const t = await buildTarget();
      const r = copy(source, t.url);
      expect(r.code).toBe(1);
      expect(r.err).toContain("Refusing to copy: 1 auth.users email(s) are not lower-case and trimmed.");
      expect(r.err + r.out).not.toMatch(/guest@example\.test/i);
      // Refused before anything was written.
      expect(Object.values(await rowCounts(t.url)).every((n) => n === 0)).toBe(true);

      const c = check(source, target.url);
      expect(c.code).toBe(1);
      expect(c.out).toContain("CHECK_A: 1 auth.users email(s) are not lower-case and trimmed.");
      expect(c.out).not.toMatch(/guest@example\.test/i);
    } finally {
      await withDb(source, (sql) => sql`update auth.users set email = 'guest@example.test' where id = ${ID.guest}`);
    }
    expect(check(source, target.url).code).toBe(0);
  });

  it("the check reports orphaned foreign keys and a disabled trigger on the copy", async () => {
    const t = await buildTarget();
    expect(copy(source, t.url).code).toBe(0);
    await withDb(urlFor(t.db), async (su) => {
      await su`alter table public.context_edges disable trigger all`;
      await su`update public.context_edges set to_item = ${uid("dead")} where id = ${ID.edge}`;
      await su`alter table public.context_edges enable trigger all`;
      await su`alter table public.copy_sets disable trigger copy_sets_guard`;
    });
    const r = check(source, t.url);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/CHECK_B: foreign key context_edges_to_item_workspace_id_fkey on public\.context_edges: 1 row\(s\) point at a missing public\.context_items row/);
    expect(r.out).toContain("CHECK_B: trigger public.copy_sets.copy_sets_guard is disabled");
  });

  it("names a missing connection variable without printing any URL", () => {
    const r = run("scripts/copy-data.mjs", ["--from", "NOPE_FROM", "--to", "NOPE_TO"], { NOPE_FROM: "", NOPE_TO: "" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("NOPE_FROM is not set");
    const same = run("scripts/copy-data.mjs", ["--from", "SAME_A", "--to", "SAME_B"], { SAME_A: source, SAME_B: source });
    expect(same.code).toBe(1);
    expect(same.err).toContain("hold the same connection string");
    expect(same.err).not.toContain("postgres://");
  });
});

describe("N-6 copy order", () => {
  const table = (oid: number, name: string, fks: Array<[string, number, string, boolean]>) => ({
    oid,
    full: `public.${name}`,
    pk: ["id"],
    columns: [{ name: "id", notnull: true }, ...fks.map(([, , col, notnull]) => ({ name: col, notnull }))],
    fks: fks.map(([fk, parent, col]) => ({ name: fk, child: oid, parent, cols: [col], refcols: ["id"] })),
  });
  const cat = (...ts: ReturnType<typeof table>[]) => new Map(ts.map((t) => [t.oid, t]));

  it("fails loudly on a cycle that no nullable column breaks, naming the tables", () => {
    expect(() => copyOrder(cat(table(1, "a", [["a_b", 2, "b_id", true]]), table(2, "b", [["b_a", 1, "a_id", true]])))).toThrow(
      /public\.a, public\.b form a cycle that no nullable column breaks/,
    );
  });

  it("breaks a cycle at a nullable column, parents first otherwise, ignoring self-references", () => {
    const { order, deferred } = copyOrder(
      cat(
        table(3, "c", [["c_self", 3, "parent_id", false]]),
        table(1, "a", [["a_b", 2, "b_id", false], ["a_c", 3, "c_id", true]]),
        table(2, "b", [["b_a", 1, "a_id", true]]),
      ),
    );
    expect(order.map((t: { full: string }) => t.full)).toEqual(["public.c", "public.a", "public.b"]);
    expect(deferred.map((d: { fk: { name: string }; columns: string[] }) => [d.fk.name, d.columns])).toEqual([["a_b", ["b_id"]]]);
  });
});
