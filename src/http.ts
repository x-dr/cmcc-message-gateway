import type { Bindings } from "./env.js";

export function json(
  data: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function decodePathPart(value = ""): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch {
    return value;
  }
}

export async function readJson<T = unknown>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("请求体必须是合法 JSON");
  }
}

function getAuthToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (/^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }

  const apiKey = request.headers.get("x-api-key");
  if (apiKey) return apiKey.trim();

  const url = new URL(request.url);
  return (
    url.searchParams.get("token") ||
    url.searchParams.get("key") ||
    ""
  ).trim();
}

export function publicAuthorized(request: Request, env: Bindings): boolean {
  if (!env.API_TOKEN) return false;
  return getAuthToken(request) === env.API_TOKEN;
}
