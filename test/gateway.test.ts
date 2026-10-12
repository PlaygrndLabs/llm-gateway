import { describe, expect, it } from "vitest";
import { handle, type Forward } from "../src/gateway.ts";
import { classify } from "../src/routes.ts";
import { SESSION_COOKIE, issueSession, passwordMatches, readCookie, sessionIsValid } from "../src/session.ts";

const PASSWORD = "correct-horse-battery-staple-0123456789";
const NOW = 1_800_000_000;
const config = { dashboardPassword: PASSWORD, nowSeconds: () => NOW };

function recorder(): { forward: Forward; seen: Request[] } {
  const seen: Request[] = [];
  return {
    seen,
    forward: async (request) => {
      seen.push(request);
      return new Response("from cpa", { status: 200 });
    },
  };
}

function at(path: string, init: RequestInit = {}): Request {
  return new Request(`https://gateway.example${path}`, init);
}

async function sessionCookie(): Promise<string> {
  return `${SESSION_COOKIE}=${await issueSession(PASSWORD, NOW)}`;
}

describe("classify", () => {
  it.each([
    ["/v1/messages", "api"],
    ["/v1/messages/count_tokens", "api"],
    ["/v1/chat/completions", "api"],
    ["/v1beta/models", "api"],
    ["/healthz", "api"],
    ["/management.html", "dashboard"],
    ["/v0/management/config", "dashboard"],
    ["/v8/management/oauth/auth-url", "dashboard"],
    ["/", "home"],
    ["/login", "login"],
    ["/logout", "logout"],
    ["/anthropic/callback", "blocked"],
    ["/codex/callback", "blocked"],
    ["/callback", "blocked"],
    ["/v1", "blocked"],
    ["/v0/management", "blocked"],
    ["/v1/%2e%2e/v0/management/config", "blocked"],
    ["/v1/..%2Fv0/management/config", "blocked"],
    ["/v1//messages", "blocked"],
  ])("%s is %s", (path, route) => {
    expect(classify(path)).toBe(route);
  });

  it("sees the path after URL normalisation", () => {
    expect(classify(new URL("https://gateway.example/v1/../v0/management/config").pathname)).toBe("dashboard");
  });
});

describe("session", () => {
  it("accepts its own token until it expires", async () => {
    const token = await issueSession(PASSWORD, NOW);
    expect(await sessionIsValid(PASSWORD, token, NOW + 60)).toBe(true);
    expect(await sessionIsValid(PASSWORD, token, NOW + 12 * 60 * 60)).toBe(false);
  });

  it("rejects tokens signed with another password or edited", async () => {
    const token = await issueSession(PASSWORD, NOW);
    expect(await sessionIsValid("another-password", token, NOW)).toBe(false);
    const [, signature] = token.split(".");
    expect(await sessionIsValid(PASSWORD, `${NOW + 999_999}.${signature}`, NOW)).toBe(false);
    expect(await sessionIsValid(PASSWORD, "garbage", NOW)).toBe(false);
    expect(await sessionIsValid(PASSWORD, `${token}.extra`, NOW)).toBe(false);
  });

  it("compares passwords exactly and never matches an empty secret", async () => {
    expect(await passwordMatches(PASSWORD, PASSWORD)).toBe(true);
    expect(await passwordMatches(`${PASSWORD}x`, PASSWORD)).toBe(false);
    expect(await passwordMatches("", "")).toBe(false);
  });

  it("reads one cookie out of a header", () => {
    expect(readCookie("a=1; b=two=2; c=3", "b")).toBe("two=2");
    expect(readCookie("a=1", "b")).toBeNull();
    expect(readCookie(null, "b")).toBeNull();
  });
});

describe("handle", () => {
  it("forwards API calls to CPA without the browser's cookies", async () => {
    const { forward, seen } = recorder();
    const response = await handle(
      at("/v1/messages", { method: "POST", headers: { "x-api-key": "client-key", cookie: await sessionCookie() }, body: "{}" }),
      config,
      forward,
    );
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers.get("x-api-key")).toBe("client-key");
    expect(seen[0]?.headers.get("cookie")).toBeNull();
    expect(await seen[0]?.text()).toBe("{}");
  });

  it("never forwards blocked paths", async () => {
    const { forward, seen } = recorder();
    for (const path of ["/anthropic/callback?code=x", "/codex/callback", "/robots.txt", "/v1"]) {
      expect((await handle(at(path), config, forward)).status).toBe(404);
    }
    expect(seen).toHaveLength(0);
  });

  it("keeps the dashboard closed without a session", async () => {
    const { forward, seen } = recorder();
    const page = await handle(at("/management.html"), config, forward);
    expect(page.status).toBe(303);
    expect(page.headers.get("location")).toBe("/login");
    const api = await handle(at("/v8/management/config", { headers: { authorization: "Bearer guess" } }), config, forward);
    expect(api.status).toBe(401);
    const forged = await handle(at("/v0/management/config", { headers: { cookie: `${SESSION_COOKIE}=1.abc` } }), config, forward);
    expect(forged.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("opens the dashboard with a valid session", async () => {
    const { forward, seen } = recorder();
    const response = await handle(at("/v8/management/config", { headers: { cookie: await sessionCookie() } }), config, forward);
    expect(response.status).toBe(200);
    expect(seen[0]?.headers.get("cookie")).toBeNull();
  });

  it("signs in with the right password and sets a strict cookie", async () => {
    const { forward } = recorder();
    const response = await handle(
      at("/login", { method: "POST", body: new URLSearchParams({ password: PASSWORD }) }),
      config,
      forward,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/management.html");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=\\d+\\.[A-Za-z0-9_-]+; `));
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const token = readCookie(cookie.split(";")[0] ?? "", SESSION_COOKIE) ?? "";
    expect(await sessionIsValid(PASSWORD, token, NOW)).toBe(true);
  });

  it("refuses a wrong password", async () => {
    const { forward } = recorder();
    const response = await handle(at("/login", { method: "POST", body: new URLSearchParams({ password: "nope" }) }), config, forward);
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toContain("Wrong password.");
  });

  it("sends the home page to login or the dashboard", async () => {
    const { forward } = recorder();
    expect((await handle(at("/"), config, forward)).headers.get("location")).toBe("/login");
    const signed = await handle(at("/", { headers: { cookie: await sessionCookie() } }), config, forward);
    expect(signed.headers.get("location")).toBe("/management.html");
  });

  it("serves the login form and clears the cookie on logout", async () => {
    const { forward } = recorder();
    const form = await handle(at("/login"), config, forward);
    expect(form.status).toBe(200);
    expect(await form.text()).toContain('name="password"');
    const out = await handle(at("/logout"), config, forward);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
