import { classify } from "./routes.ts";
import { SESSION_COOKIE, SESSION_SECONDS, issueSession, passwordMatches, readCookie, sessionIsValid } from "./session.ts";
import { loginPage } from "./login-page.ts";

export type Forward = (request: Request) => Promise<Response>;

export interface GatewayConfig {
  readonly dashboardPassword: string;
  readonly nowSeconds: () => number;
}

const MAX_LOGIN_BODY = 4096;

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

async function signedIn(request: Request, config: GatewayConfig): Promise<boolean> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return token !== null && (await sessionIsValid(config.dashboardPassword, token, config.nowSeconds()));
}

async function login(request: Request, config: GatewayConfig): Promise<Response> {
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
      return forward(withoutCookies(request));
    case "home":
      return redirect((await signedIn(request, config)) ? "/management.html" : "/login");
    case "login":
      if (request.method === "POST") return login(request, config);
      if (request.method === "GET") return html(loginPage(null));
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
