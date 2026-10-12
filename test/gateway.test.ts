import { describe, expect, it } from "vitest";
import { handle, type Forward } from "../src/gateway.ts";
import { classify } from "../src/routes.ts";
import { SESSION_COOKIE, issueSession, passwordMatches, readCookie, sessionIsValid } from "../src/session.ts";

const PASSWORD = "correct-horse-battery-staple-0123456789";
const NOW = 1_800_000_000;
const CLIENT_KEY = "client-key-0123456789abcdef0123456789abcdef";
const config = { dashboardPassword: PASSWORD, nowSeconds: () => NOW, clientKeys: async () => [CLIENT_KEY] };

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
    ["/healthz", "health"],
    ["/management.html", "dashboard"],
    ["/v0/management/config", "dashboard"],
    ["/v8/management/oauth/auth-url", "dashboard"],
    ["/", "home"],
    ["/login", "login"],
    ["/logout", "logout"],
    ["/anthropic/callback", "blocked"],
    ["/codex/callback", "blocked"],
    ["/callback", "oauth-callback"],
    ["/auth/callback", "oauth-callback"],
    ["/oauth-callback", "oauth-callback"],
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
      at("/v1/messages", { method: "POST", headers: { "x-api-key": CLIENT_KEY, cookie: await sessionCookie() }, body: "{}" }),
      config,
      forward,
    );
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers.get("x-api-key")).toBe(CLIENT_KEY);
    expect(seen[0]?.headers.get("cookie")).toBeNull();
    expect(await seen[0]?.text()).toBe("{}");
  });

  it("accepts the key wherever CPA reads it", async () => {
    const { forward, seen } = recorder();
    const requests = [
      at("/v1/models", { headers: { authorization: `Bearer ${CLIENT_KEY}` } }),
      at("/v1/models", { headers: { authorization: `bearer  ${CLIENT_KEY} ` } }),
      at("/v1/models", { headers: { authorization: CLIENT_KEY } }),
      at("/v1beta/models", { headers: { "x-goog-api-key": CLIENT_KEY } }),
      at(`/v1beta/models?key=${CLIENT_KEY}`),
      at(`/v1/models?auth_token=${CLIENT_KEY}`),
    ];
    for (const request of requests) expect((await handle(request, config, forward)).status).toBe(200);
    expect(seen).toHaveLength(requests.length);
  });

  it("refuses API calls without a key the dashboard made", async () => {
    const { forward, seen } = recorder();
    expect((await handle(at("/v1/models"), config, forward)).status).toBe(401);
    expect((await handle(at("/v1/models", { headers: { "x-api-key": "guess" } }), config, forward)).status).toBe(401);
    expect((await handle(at("/v1/models", { headers: { authorization: "Basic abc" } }), config, forward)).status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("refuses every API call while the dashboard has no keys, which CPA alone would let through", async () => {
    const { forward, seen } = recorder();
    const empty = { ...config, clientKeys: async () => [] };
    const response = await handle(at("/v1/models", { headers: { "x-api-key": "anything" } }), empty, forward);
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).toContain("API Keys in the dashboard");
    expect(seen).toHaveLength(0);
  });

  it("forwards the health check without a key", async () => {
    const { forward, seen } = recorder();
    const empty = { ...config, clientKeys: async () => [] };
    expect((await handle(at("/healthz"), empty, forward)).status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it("hands a provider's callback to CPA for a signed-in user", async () => {
    const { forward, seen } = recorder();
    const response = await handle(
      at("/callback?code=abc&state=f1d66a216e61aab0375b6857db64a6a5", { headers: { cookie: await sessionCookie() } }),
      config,
      forward,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Login received");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://gateway.example/v0/management/oauth-callback?code=abc&state=f1d66a216e61aab0375b6857db64a6a5");
    expect(seen[0]?.headers.get("cookie")).toBeNull();
  });

  it("keeps the callback closed without a session", async () => {
    const { forward, seen } = recorder();
    const response = await handle(at("/auth/callback?code=abc&state=xyz"), config, forward);
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("Sign in");
    expect(seen).toHaveLength(0);
  });

  it("explains a callback CPA refuses", async () => {
    const refused: Forward = async () => Response.json({ status: "error", error: "unknown or expired state" }, { status: 404 });
    const response = await handle(at("/oauth-callback?code=abc&state=xyz", { headers: { cookie: await sessionCookie() } }), config, refused);
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).toContain("unknown or expired state");
    expect(text).toContain("Start the login again");
  });

  it("never forwards blocked paths", async () => {
    const { forward, seen } = recorder();
    for (const path of ["/anthropic/callback?code=x", "/codex/callback", "/devin/callback", "/robots.txt", "/v1"]) {
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

  it("turns sign-in off while the dashboard password is missing or short", async () => {
    const { forward } = recorder();
    const weak = { ...config, dashboardPassword: "short" };
    const form = await handle(at("/login"), weak, forward);
    expect(await form.text()).toContain("Sign-in is off");
    const attempt = await handle(at("/login", { method: "POST", body: new URLSearchParams({ password: "short" }) }), weak, forward);
    expect(attempt.status).toBe(503);
    expect(attempt.headers.get("set-cookie")).toBeNull();
    const forgedWithKnownPassword = `${SESSION_COOKIE}=${await issueSession("short", NOW)}`;
    const dashboard = await handle(at("/v8/management/config", { headers: { cookie: forgedWithKnownPassword } }), weak, forward);
    expect(dashboard.status).toBe(401);
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
