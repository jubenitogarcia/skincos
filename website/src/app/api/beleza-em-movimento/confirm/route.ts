import { NextRequest } from "next/server";
import { confirmBeautyMovementInvite } from "@/lib/beautyMovementDb";
import {
  beautyMovementInvalidResponse,
  beautyMovementJson,
  beautyMovementUnavailableResponse,
  getBeautyMovementClientIp,
  getBeautyMovementSessionToken,
  hasBeautyMovementAllowedOrigin,
  nullableEmail,
  readBeautyMovementJson,
} from "@/lib/beautyMovementRoute";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await hasBeautyMovementAllowedOrigin(request))) return beautyMovementInvalidResponse();
  const body = await readBeautyMovementJson(request);
  const email = nullableEmail(body?.email);
  if (!body || email === undefined || body.operationalConsent !== true) return beautyMovementInvalidResponse();

  const result = await confirmBeautyMovementInvite({
    sessionToken: getBeautyMovementSessionToken(request),
    email,
    operationalConsent: true,
    origin: request.headers.get("origin"),
    ip: getBeautyMovementClientIp(request),
  });

  if (result.ok) return beautyMovementJson({ ok: true, state: result.state, replay: result.replay === true });
  return result.error === "campaign_unavailable"
    ? beautyMovementUnavailableResponse()
    : beautyMovementInvalidResponse();
}
