import { describe, expect, it } from "vite-plus/test";

import { claudeMcpServersFromInit } from "./claudeMcpServers.ts";

describe("claudeMcpServersFromInit", () => {
  it("maps each server state the CLI reports and keeps its order", () => {
    expect(
      claudeMcpServersFromInit({
        type: "system",
        subtype: "init",
        mcp_servers: [
          { name: "github", status: "connected" },
          { name: "linear", status: "needs-auth" },
          { name: "broken", status: "failed" },
          { name: "slow", status: "pending" },
          { name: "off", status: "disabled" },
        ],
      }),
    ).toEqual([
      { name: "github", status: "connected" },
      { name: "linear", status: "needs_auth" },
      { name: "broken", status: "failed" },
      { name: "slow", status: "pending" },
      { name: "off", status: "disabled" },
    ]);
  });

  it("drops a state it does not recognise instead of guessing one", () => {
    expect(
      claudeMcpServersFromInit({
        type: "system",
        subtype: "init",
        mcp_servers: [
          { name: "github", status: "connected" },
          { name: "odd", status: "reconnecting" },
        ],
      }),
    ).toEqual([{ name: "github", status: "connected" }]);
  });

  it("reports nothing for other messages", () => {
    expect(claudeMcpServersFromInit({ type: "assistant" })).toBeNull();
    expect(claudeMcpServersFromInit({ type: "system", subtype: "task_started" })).toBeNull();
  });
});
