import { normalizeEmail, bareAddress } from "./emailUtils";

describe("bareAddress", () => {
  it("returns the address inside angle brackets, lower-cased", () => {
    expect(bareAddress('"Alice Smith" <Alice@Acme.com>')).toBe("alice@acme.com");
  });

  it("returns a bare address trimmed and lower-cased", () => {
    expect(bareAddress("  Bob@Example.COM ")).toBe("bob@example.com");
  });

  it("drops stray brackets when there is no bracketed address", () => {
    expect(bareAddress("<carol@x.org")).toBe("carol@x.org");
  });
});

describe("normalizeEmail", () => {
  it("lowercases an email address", () => {
    expect(normalizeEmail("User@Example.COM")).toBe("user@example.com");
  });

  it("trims whitespace", () => {
    expect(normalizeEmail("  user@example.com  ")).toBe("user@example.com");
  });

  it("handles both trim and lowercase", () => {
    expect(normalizeEmail("  User@Example.COM  ")).toBe("user@example.com");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeEmail("")).toBe("");
  });

  it("handles already normalized email", () => {
    expect(normalizeEmail("user@example.com")).toBe("user@example.com");
  });

  it("handles mixed-case local and domain parts", () => {
    expect(normalizeEmail("John.Doe@Gmail.Com")).toBe("john.doe@gmail.com");
  });
});
