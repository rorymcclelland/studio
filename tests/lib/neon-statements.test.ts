// Sprint 6 review: the splitter behind the Neon connector's statement lists
// (scripts/neon-statements.mjs). An unclosed quote or comment is an error
// naming its line, never a loop or a mangled statement; dollar-quote tags may
// hold digits. That split files build the same schema as the runner is in
// tests/db/migrate.test.ts.
import { describe, expect, it } from "vitest";
import { split, SplitError } from "../../scripts/neon-statements.mjs";

describe("neon-statements split", () => {
  it("splits on semicolons outside quotes, comments and dollar quotes", () => {
    const sql = [
      "-- header; not a statement",
      "create table t (a text default 'x;y', \"b;c\" int);",
      "/* a; comment /* nested; */ still; comment */ insert into t values ('it''s; fine', 1);",
      "select E'a\\'; b';",
      "create function f() returns int language sql as $$ select 1; $$;",
      "create function g() returns int language plpgsql as $body$ begin return 2; end $body$;",
    ].join("\n");
    expect(split(sql)).toEqual([
      "create table t (a text default 'x;y', \"b;c\" int)",
      "/* a; comment /* nested; */ still; comment */ insert into t values ('it''s; fine', 1)",
      "select E'a\\'; b'",
      "create function f() returns int language sql as $$ select 1; $$",
      "create function g() returns int language plpgsql as $body$ begin return 2; end $body$",
    ]);
  });

  it("accepts dollar-quote tags with digits, and a different tag inside one", () => {
    const sql = "do $tag1$ begin perform $x2$;$x2$; perform 1; end $tag1$; select 2";
    expect(split(sql)).toEqual(["do $tag1$ begin perform $x2$;$x2$; perform 1; end $tag1$", "select 2"]);
  });

  it("doesn't take $1 or a $ inside a word for a dollar quote", () => {
    expect(split("prepare p as select $1; select a$b$ from t; select 3")).toEqual(["prepare p as select $1", "select a$b$ from t", "select 3"]);
  });

  it("keeps doubled double quotes inside an identifier", () => {
    expect(split('select 1 as "a"";b"; select 2')).toEqual(['select 1 as "a"";b"', "select 2"]);
  });

  it("drops empty and comment-only pieces", () => {
    expect(split(";;\n-- only a comment\n;  ;")).toEqual([]);
  });

  const unclosed: [string, string, RegExp][] = [
    ["a ' string", "select 1;\nselect 'oops;\nselect 2;", /Unclosed ' string starting on line 2/],
    ["an E'' string ending in an escaped quote", "select E'oops\\';", /Unclosed ' string starting on line 1/],
    ['a " identifier', 'select 1;\n\nselect "oops from t;', /Unclosed " identifier starting on line 3/],
    ["a /* comment", "select 1; /* oops\nselect 2;", /Unclosed \/\* comment starting on line 1/],
    ["a nested /* comment closed only once", "/* a /* b */ select 1;", /Unclosed \/\* comment starting on line 1/],
    ["a $$ quote", "create function f() returns int language sql as $$ select 1;", /Unclosed dollar quote \$\$ starting on line 1/],
    ["a $tag1$ quote closed with another tag", "do $tag1$ begin null; end $tag2$;", /Unclosed dollar quote \$tag1\$ starting on line 1/],
  ];
  for (const [what, sql, message] of unclosed) {
    it(`throws, naming the line, on ${what}`, () => {
      const started = Date.now();
      expect(() => split(sql)).toThrow(SplitError);
      expect(() => split(sql)).toThrow(message);
      expect(Date.now() - started).toBeLessThan(1000);
    });
  }
});
