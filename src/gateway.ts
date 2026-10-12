import { keyIsAllowed } from "./client-keys.ts";
import { classify } from "./routes.ts";
import { SESSION_COOKIE, SESSION_SECONDS, issueSession, passwordMatches, readCookie, sessionIsValid } from "./session.ts";
import { loginPage } from "./login-page.ts";

export type Forward = (request: Request) => Promise<Response>;

export interface GatewayConfig {
  readonly dashboardPassword: string;
  readonly nowSeconds: () => number;
  readonly clientKeys: () => Promise<string[]>;
}

const MAX_LOGIN_BODY = 4096;
export const MIN_PASSWORD_LENGTH = 16;
const NO_CLIENT_KEYS = "No API key is set up yet: add one under API Keys in the dashboard.";
const PASSWORD_NOT_SET = `Sign-in is off: set the DASHBOARD_PASSWORD secret to at least ${MIN_PASSWORD_LENGTH} characters.`;

function redirect(location: string, headers: HeadersInit = {}): Response {
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store", ...headers } });
}

function notFound(): Response {
  return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "x-frame-options": "DENY",
    },
  });
}

function withoutCookies(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  return new Request(request, { headers });
}

async function api(request: Request, config: GatewayConfig, forward: Forward): Promise<Response> {
  const allowed = await config.clientKeys();
  if (allowed.length === 0) return Response.json({ error: { type: "authentication_error", message: NO_CLIENT_KEYS } }, { status: 401 });
  if (!(await keyIsAllowed(request, allowed))) {
    return Response.json({ error: { type: "authentication_error", message: "Invalid API key." } }, { status: 401 });
  }
  return forward(withoutCookies(request));
}

async function signedIn(request: Request, config: GatewayConfig): Promise<boolean> {
  if (config.dashboardPassword.length < MIN_PASSWORD_LENGTH) return false;
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return token !== null && (await sessionIsValid(config.dashboardPassword, token, config.nowSeconds()));
}

async function login(request: Request, config: GatewayConfig): Promise<Response> {
  if (config.dashboardPassword.length < MIN_PASSWORD_LENGTH) return html(loginPage(PASSWORD_NOT_SET), 503);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > MAX_LOGIN_BODY) return html(loginPage("Request too large."), 413);
  const form = await request.formData().catch(() => null);
  const password = form?.get("password");
  if (typeof password !== "string" || !(await passwordMatches(password, config.dashboardPassword))) {
    return html(loginPage("Wrong password."), 401);
  }
  const token = await issueSession(config.dashboardPassword, config.nowSeconds());
  return redirect("/management.html", {
    "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
  });
}

export async function handle(request: Request, config: GatewayConfig, forward: Forward): Promise<Response> {
  const url = new URL(request.url);
  switch (classify(url.pathname)) {
    case "api":
      return api(request, config, forward);
    case "health":
      return forward(withoutCookies(request));
    case "home":
      return redirect((await signedIn(request, config)) ? "/management.html" : "/login");
    case "login":
      if (request.method === "POST") return login(request, config);
      if (request.method === "GET") {
        return html(loginPage(config.dashboardPassword.length < MIN_PASSWORD_LENGTH ? PASSWORD_NOT_SET : null));
      }
      return notFound();
    case "logout":
      return redirect("/login", { "set-cookie": `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0` });
    case "dashboard":
      if (await signedIn(request, config)) return forward(withoutCookies(request));
      if (request.method === "GET" && url.pathname === "/management.html") return redirect("/login");
      return Response.json({ error: "sign in at /login first" }, { status: 401 });
    case "blocked":
      return notFound();
  }
}
