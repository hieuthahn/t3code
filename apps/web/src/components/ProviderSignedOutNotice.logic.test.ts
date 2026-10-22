import { describe, expect, it } from "vite-plus/test";
import type { ServerProvider } from "@t3tools/contracts";

import { signedOutNoticeChanges } from "./ProviderSignedOutNotice.logic";

const provider = (
  instanceId: string,
  authStatus: "authenticated" | "unauthenticated" | "unknown",
  extra: Partial<{ enabled: boolean; installed: boolean }> = {},
) =>
  ({
    instanceId,
    driver: "claudeAgent",
    displayName: instanceId,
    enabled: extra.enabled ?? true,
    installed: extra.installed ?? true,
    auth: { status: authStatus },
  }) as unknown as ServerProvider;

describe("signedOutNoticeChanges", () => {
  it("announces each newly signed-out account once", () => {
    const first = signedOutNoticeChanges([provider("viet", "unauthenticated")], new Set());
    expect(first.announce.map((entry) => entry.instanceId)).toEqual(["viet"]);
    const again = signedOutNoticeChanges([provider("viet", "unauthenticated")], new Set(["viet"]));
    expect(again.announce).toEqual([]);
  });

  it("forgets an account once it signs in again, so a later sign-out is announced", () => {
    const changes = signedOutNoticeChanges([provider("viet", "authenticated")], new Set(["viet"]));
    expect(changes.forget).toEqual(["viet"]);
  });

  it("ignores disabled, missing and unknown accounts", () => {
    const changes = signedOutNoticeChanges(
      [
        provider("a", "unauthenticated", { enabled: false }),
        provider("b", "unauthenticated", { installed: false }),
        provider("c", "unknown"),
      ],
      new Set(),
    );
    expect(changes.announce).toEqual([]);
  });
});
