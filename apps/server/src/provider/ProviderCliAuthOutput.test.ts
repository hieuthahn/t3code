import { assert, describe, it } from "@effect/vitest";

import { extractAuthorizeUrl, redactCliAuthOutput } from "./ProviderCliAuthOutput.ts";

const URL_TEXT =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=abc&login_hint=a%40b.tech";

describe("extractAuthorizeUrl", () => {
  it("reads the link out of terminal hyperlink escapes", () => {
    const output = `Opening browser to sign in…\nIf the browser didn't open, visit: \u001b]8;;${URL_TEXT}\u0007${URL_TEXT}\u001b]8;;\u0007\nPaste code here if prompted > `;
    assert.equal(extractAuthorizeUrl(output), URL_TEXT);
  });

  it("reads a plain link and ignores unrelated links", () => {
    assert.equal(
      extractAuthorizeUrl(`See https://docs.example.com/help then visit ${URL_TEXT}\n`),
      URL_TEXT,
    );
  });

  it("waits for the link to appear", () => {
    assert.isUndefined(extractAuthorizeUrl("Opening browser to sign in…\n"));
  });
});

describe("redactCliAuthOutput", () => {
  it("hides the sign-in link's parameters and token-shaped values", () => {
    const output = `visit: \u001b]8;;${URL_TEXT}\u0007${URL_TEXT}\u001b]8;;\u0007 token sk-ant-oat01-${"a".repeat(40)}`;
    const redacted = redactCliAuthOutput(output);
    assert.equal(
      redacted,
      "visit: https://claude.com/cai/oauth/authorize?<redacted> token <redacted>",
    );
  });

  it("keeps an ordinary CLI error readable", () => {
    assert.equal(
      redactCliAuthOutput("Login failed: Request failed with status code 400"),
      "Login failed: Request failed with status code 400",
    );
  });
});
