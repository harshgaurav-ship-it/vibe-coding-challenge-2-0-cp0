import { NextResponse } from "next/server";

const MAX_BODY_BYTES = 16_384;

export async function readJson(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false as const, status: 415, error: "Send a JSON request." };
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return { ok: false as const, status: 413, error: "Request is too large." };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { ok: false as const, status: 413, error: "Request is too large." };
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false as const, status: 400, error: "Invalid request." };
    return { ok: true as const, body: body as Record<string, unknown> };
  } catch {
    return { ok: false as const, status: 400, error: "Invalid request." };
  }
}

export function sameOriginFailure(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    if (new URL(origin).host === new URL(request.url).host) return null;
  } catch {
    // Malformed origins are rejected below.
  }
  return NextResponse.json({ error: "This request could not be verified." }, { status: 403 });
}

export function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
