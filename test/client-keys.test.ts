import { describe, expect, it } from "vitest";
import { parseClientKeys, presentedKeys } from "../src/client-keys.ts";

describe("parseClientKeys", () => {
  it("reads access.api-keys from CPA's v8 config", () => {
    const config = [
      "config-version: 8",
      "# keys made in the dashboard",
      "access:",
      "    api-keys:",
      "        - app-one-key",
      '        - "app-two-key"',
      "        - app-one-key",
      "api-keys:",
      "    claude:",
      "        - api-key: upstream-provider-key",
    ].join("\n");
    expect(parseClientKeys(config)).toEqual(["app-one-key", "app-two-key"]);
  });

  it("reads a legacy top-level list of client keys", () => {
    expect(parseClientKeys('api-keys:\n  - "legacy-key"\n')).toEqual(["legacy-key"]);
  });

  it("finds no keys in an empty list, a missing section or a broken file", () => {
    expect(parseClientKeys("access:\n  api-keys: []\n")).toEqual([]);
    expect(parseClientKeys("config-version: 8\n")).toEqual([]);
    expect(parseClientKeys("")).toEqual([]);
    expect(parseClientKeys("access: [unclosed")).toEqual([]);
    expect(parseClientKeys("access:\n  api-keys:\n    - 42\n    - '  '\n")).toEqual([]);
  });
});

describe("presentedKeys", () => {
  it("collects every place a client can send a key", () => {
    const request = new Request("https://gateway.example/v1/models?key=q&auth_token=t", {
      headers: { authorization: "Bearer b", "x-goog-api-key": "g", "x-api-key": "x" },
    });
    expect(presentedKeys(request)).toEqual(["b", "g", "x", "q", "t"]);
  });

  it("returns nothing for a bare request", () => {
    expect(presentedKeys(new Request("https://gateway.example/v1/models"))).toEqual([]);
  });
});
