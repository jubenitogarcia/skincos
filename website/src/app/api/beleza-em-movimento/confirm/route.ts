import { NextRequest } from "next/server";
import { confirmBeautyMovementInvite } from "@/lib/beautyMovementDb";
import {
  beautyMovementInvalidResponse,
  beautyMovementJson,
  beautyMovementUnavailableResponse,
  clearBeautyMovementLegacySessionCookie,
  clearBeautyMovementSessionCookie,
  getBeautyMovementClientIp,
  getBeautyMovementSessionCredential,
  hasBeautyMovementAllowedOrigin,
  nullableEmail,
  readBeautyMovementJson,
} from "@/lib/beautyMovementRoute";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await hasBeautyMovementAllowedOrigin(request))) return beautyMovementInvalidResponse();
  const body = await readBeautyMovementJson(request);
  const email = nullableEmail(body?.email);
  if (!body || email === undefined) return beautyMovementInvalidResponse();
  const credential = getBeautyMovementSessionCredential(request);

  const result = await confirmBeautyMovementInvite({
    sessionToken: credential?.sessionToken,
    contextRef: credential?.contextRef,
    email,
    operationalConsent: body.operationalConsent === true,
    origin: request.headers.get("origin"),
    ip: getBeautyMovementClientIp(request),
  });

  if (result.ok) return beautyMovementJson({ ok: true, state: result.state, replay: result.replay === true });
  const response = result.error === "campaign_unavailable"
    ? beautyMovementUnavailableResponse()
    : beautyMovementInvalidResponse();
  if (result.error === "session_unavailable" && credential) {
    clearBeautyMovementSessionCookie(response, credential.contextRef);
    clearBeautyMovementLegacySessionCookie(response);
  }
  return response;
}
