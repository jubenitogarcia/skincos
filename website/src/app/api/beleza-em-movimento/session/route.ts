import { NextRequest } from "next/server";
import {
  BEAUTY_MOVEMENT_SESSION_TTL_MS,
  exchangeBeautyMovementInvite,
} from "@/lib/beautyMovementDb";
import {
  beautyMovementInvalidResponse,
  beautyMovementJson,
  beautyMovementUnavailableResponse,
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
  if (!token) return beautyMovementInvalidResponse();

  const result = await exchangeBeautyMovementInvite({
    token,
    origin: request.headers.get("origin"),
    ip: getBeautyMovementClientIp(request),
  });

  if (!result.ok) {
    return result.error === "campaign_unavailable"
      ? beautyMovementUnavailableResponse()
      : beautyMovementInvalidResponse();
  }

  const response = beautyMovementJson({ ok: true, state: result.state });
  const expiresAtMs =
    "sessionExpiresAtMs" in result && typeof result.sessionExpiresAtMs === "number"
      ? result.sessionExpiresAtMs
      : Date.now() + BEAUTY_MOVEMENT_SESSION_TTL_MS;
  setBeautyMovementSessionCookie(response, result.sessionToken, expiresAtMs);
  return response;
}
