/**
 * FTS5 escaping, verified against **real SQLite** (audit P8 + P12).
 *
 * The bug this covers was invisible to the existing suite precisely because
 * SQLite was always mocked: `messages_fts MATCH ?` takes an FTS5 *query
 * language*, so parameter binding does not protect it — the bound value is
 * still parsed as a query. Typing `foo"` in the search box raised
 * `fts5: syntax error` at runtime.
 *
 * These tests execute the generated MATCH expression against a real FTS5 index,
 * which is the only way to know it parses.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSqliteHarness } from "@/test/sqliteHarness";
import { escapeFtsQuery } from "./searchQueryBuilder";

describe("escapeFtsQuery against real FTS5", () => {
  let harness: ReturnType<typeof createSqliteHarness>;

  beforeEach(() => {
    harness = createSqliteHarness();
    harness.raw.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(subject, body_text, tokenize='trigram');
      INSERT INTO messages_fts (subject, body_text)
        VALUES ('Quarterly review', 'Please review the "final" numbers before Friday.');
      INSERT INTO messages_fts (subject, body_text)
        VALUES ('Lunch', 'Taco place on 5th? -- Sam');
    `);
  });

  afterEach(() => harness.close());

  function search(userInput: string): number {
    const match = escapeFtsQuery(userInput);
    return harness.raw
      .prepare<{ n: number }>("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH ?")
      .get(match)!.n;
  }

  /**
   * Every one of these raised `fts5: syntax error` before escaping, because
   * each is meaningful in the FTS5 query language.
   */
  const HOSTILE_INPUTS = [
    'foo"',
    '"',
    '""',
    "foo OR bar",
    "foo AND bar",
    "foo NOT bar",
    "NEAR(a b)",
    "a*",
    "-foo",
    "(foo",
    "foo)",
    "{a b}",
    "col:value",
    "^anchor",
    'unbalanced "quote here',
    "a AND (b OR c",
  ];

  it.each(HOSTILE_INPUTS)("does not raise a syntax error for %j", (input) => {
    expect(() => search(input)).not.toThrow();
  });

  it("still finds what the user meant", () => {
    expect(search("review")).toBe(1);
    expect(search("Quarterly")).toBe(1);
    expect(search("taco")).toBe(1);
  });

  it("treats a quoted word in the body as a literal, not as syntax", () => {
    // The stored body contains the word "final" in quotes.
    expect(search('"final"')).toBe(1);
    expect(search("final")).toBe(1);
  });

  it("treats operators as literal terms rather than as query syntax", () => {
    // "OR" is not an operator here; nothing in the corpus contains the literal
    // words `foo` or `bar`, so an operator interpretation would have matched
    // both rows.
    expect(search("foo OR bar")).toBe(0);
  });

  it("doubles embedded quotes rather than dropping them", () => {
    expect(escapeFtsQuery('say "hi"')).toBe('"say" """hi"""');
  });

  it("produces an empty expression for empty or whitespace input", () => {
    expect(escapeFtsQuery("")).toBe("");
    expect(escapeFtsQuery("   ")).toBe("");
  });
});
