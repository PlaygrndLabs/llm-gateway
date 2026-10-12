export type Route = "api" | "health" | "oauth-callback" | "dashboard" | "home" | "login" | "logout" | "blocked";

const API_PREFIXES = ["/v1/", "/v1beta/"];
const DASHBOARD_PREFIXES = ["/v0/management/", "/v8/management/"];
const OAUTH_CALLBACK_PATHS = ["/callback", "/auth/callback", "/oauth-callback"];
const ENCODED_SEPARATORS = /%2f|%5c|%2e/i;

export function classify(pathname: string): Route {
  if (ENCODED_SEPARATORS.test(pathname) || pathname.includes("\\") || pathname.includes("//")) return "blocked";
  if (pathname === "/") return "home";
  if (pathname === "/login") return "login";
  if (pathname === "/logout") return "logout";
  if (pathname === "/healthz") return "health";
  if (OAUTH_CALLBACK_PATHS.includes(pathname)) return "oauth-callback";
  if (API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return "api";
  if (pathname === "/management.html" || DASHBOARD_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return "dashboard";
  return "blocked";
}
