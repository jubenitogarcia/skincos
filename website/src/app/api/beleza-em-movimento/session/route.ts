import { NextRequest } from "next/server";
import {
  BEAUTY_MOVEMENT_SESSION_TTL_MS,
  exchangeBeautyMovementInvite,
} from "@/lib/beautyMovementDb";
import {
  beautyMovementInvalidResponse,
  beautyMovementJson,
  beautyMovementUnavailableResponse,
  clearBeautyMovementLegacySessionCookie,
  getBeautyMovementClientIp,
  hasBeautyMovementAllowedOrigin,
  readBeautyMovementJson,
  setBeautyMovementSessionCookie,
  stringField,
} from "@/lib/beautyMovementRoute";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await hasBeautyMovementAllowedOrigin(request))) return beautyMovementInvalidResponse();
  const body = await readBeautyMovementJson(request);
  const token = stringField(body?.token, 256);
  if (!token) {
    const response = beautyMovementInvalidResponse();
    clearBeautyMovementLegacySessionCookie(response);
    return response;
  }

  const result = await exchangeBeautyMovementInvite({
    token,
    origin: request.headers.get("origin"),
    ip: getBeautyMovementClientIp(request),
  });

  if (!result.ok) {
    const response = result.error === "campaign_unavailable"
      ? beautyMovementUnavailableResponse()
      : beautyMovementInvalidResponse();
    // A new-link attempt must never fall back to the pre-context global
    // cookie, even when the new token is invalid or unavailable.
    clearBeautyMovementLegacySessionCookie(response);
    return response;
  }

  const response = beautyMovementJson({ ok: true, contextRef: result.contextRef, state: result.state });
  const expiresAtMs =
    "sessionExpiresAtMs" in result && typeof result.sessionExpiresAtMs === "number"
      ? result.sessionExpiresAtMs
      : Date.now() + BEAUTY_MOVEMENT_SESSION_TTL_MS;
  setBeautyMovementSessionCookie(response, result.contextRef, result.sessionToken, expiresAtMs);
  clearBeautyMovementLegacySessionCookie(response);
  return response;
}
