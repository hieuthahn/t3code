import { assert, describe, it } from "@effect/vitest";

import { extractClaudeAuthorizeUrl, redactClaudeAuthOutput } from "./ClaudeAuth.ts";

const URL_TEXT =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=abc&login_hint=a%40b.tech";

describe("extractClaudeAuthorizeUrl", () => {
  it("reads the link out of terminal hyperlink escapes", () => {
    const output = `Opening browser to sign in…\nIf the browser didn't open, visit: \u001b]8;;${URL_TEXT}\u0007${URL_TEXT}\u001b]8;;\u0007\nPaste code here if prompted > `;
    assert.equal(extractClaudeAuthorizeUrl(output), URL_TEXT);
  });

  it("reads a plain link and ignores unrelated links", () => {
    assert.equal(
      extractClaudeAuthorizeUrl(`See https://docs.example.com/help then visit ${URL_TEXT}\n`),
      URL_TEXT,
    );
  });

  it("waits for the link to appear", () => {
    assert.isUndefined(extractClaudeAuthorizeUrl("Opening browser to sign in…\n"));
  });
});

describe("redactClaudeAuthOutput", () => {
  it("hides the sign-in link's parameters and token-shaped values", () => {
    const output = `visit: \u001b]8;;${URL_TEXT}\u0007${URL_TEXT}\u001b]8;;\u0007 token sk-ant-oat01-${"a".repeat(40)}`;
    const redacted = redactClaudeAuthOutput(output);
    assert.equal(
      redacted,
      "visit: https://claude.com/cai/oauth/authorize?<redacted> token <redacted>",
    );
  });

  it("keeps an ordinary CLI error readable", () => {
    assert.equal(
      redactClaudeAuthOutput("Login failed: Request failed with status code 400"),
      "Login failed: Request failed with status code 400",
    );
  });
});
