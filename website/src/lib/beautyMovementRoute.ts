import { NextRequest, NextResponse } from "next/server";
import {
  BEAUTY_MOVEMENT_SESSION_COOKIE,
  isBeautyMovementOriginAllowed,
  resolveBeautyMovementAllowedOriginsAtRuntime,
} from "@/lib/beautyMovementSecurity";

const MAX_JSON_BYTES = 4_096;

export function beautyMovementJson(body: unknown, init: ResponseInit = {}): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store, no-cache, must-revalidate, private");
  response.headers.set("pragma", "no-cache");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

export function beautyMovementInvalidResponse(): NextResponse {
  // Do not distinguish revoked, expired, unknown or malformed invitations.
  return beautyMovementJson({ ok: false, error: "invalid_invitation" }, { status: 404 });
}

export function beautyMovementUnavailableResponse(): NextResponse {
  return beautyMovementJson({ ok: false, error: "campaign_unavailable" }, { status: 503 });
}

export async function hasBeautyMovementAllowedOrigin(request: NextRequest): Promise<boolean> {
  return isBeautyMovementOriginAllowed(
    request.headers.get("origin"),
    await resolveBeautyMovementAllowedOriginsAtRuntime(),
  );
}

export function getBeautyMovementClientIp(request: NextRequest): string | null {
  const fromCloudflare = request.headers.get("cf-connecting-ip")?.trim();
  if (fromCloudflare && fromCloudflare.length <= 128) return fromCloudflare;
  // This route is deployed behind Cloudflare. Do not trust a client-supplied
  // X-Forwarded-For fallback, which would let callers rotate the limiter key.
  return null;
}

export function getBeautyMovementSessionToken(request: NextRequest): string | null {
  return request.cookies.get(BEAUTY_MOVEMENT_SESSION_COOKIE)?.value?.trim() || null;
}

export async function readBeautyMovementJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const contentLength = Number(declaredLength);
    if (!Number.isInteger(contentLength) || contentLength < 0 || contentLength > MAX_JSON_BYTES) return null;
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_JSON_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function stringField(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

export function nullableEmail(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}

export function setBeautyMovementSessionCookie(response: NextResponse, token: string, expiresAtMs: number): void {
  response.cookies.set({
    name: BEAUTY_MOVEMENT_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAtMs),
    maxAge: Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000)),
  });
}

export function clearBeautyMovementSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: BEAUTY_MOVEMENT_SESSION_COOKIE,
    value: "",
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
  });
}
