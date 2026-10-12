import { parse } from "yaml";

export const CONFIG_OBJECT_KEY = "config/config.yaml";

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter((item) => item !== "");
}

export function parseClientKeys(configText: string): string[] {
  let config: unknown;
  try {
    config = parse(configText);
  } catch {
    return [];
  }
  if (typeof config !== "object" || config === null) return [];
  const root = config as Record<string, unknown>;
  const access = root["access"];
  const nested = typeof access === "object" && access !== null ? stringList((access as Record<string, unknown>)["api-keys"]) : [];
  return [...new Set([...nested, ...stringList(root["api-keys"])])];
}

export function presentedKeys(request: Request): string[] {
  const url = new URL(request.url);
  const authorization = request.headers.get("authorization") ?? "";
  const space = authorization.indexOf(" ");
  const bearer =
    space !== -1 && authorization.slice(0, space).toLowerCase() === "bearer" ? authorization.slice(space + 1).trim() : authorization;
  const candidates = [
    bearer,
    request.headers.get("x-goog-api-key"),
    request.headers.get("x-api-key"),
    url.searchParams.get("key"),
    url.searchParams.get("auth_token"),
  ];
  return candidates.filter((candidate): candidate is string => candidate !== null && candidate !== "");
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function keyIsAllowed(request: Request, allowed: readonly string[]): Promise<boolean> {
  if (allowed.length === 0) return false;
  const allowedDigests = new Set(await Promise.all(allowed.map(digest)));
  for (const candidate of presentedKeys(request)) {
    if (allowedDigests.has(await digest(candidate))) return true;
  }
  return false;
}
