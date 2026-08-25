import { NextRequest } from "next/server";
import { probeBeautyMovementCampaignCopy } from "@/lib/beautyMovementDb";
import {
  beautyMovementInvalidResponse,
  beautyMovementJson,
  beautyMovementUnavailableResponse,
  hasBeautyMovementAllowedOrigin,
  readBeautyMovementJson,
  stringField,
} from "@/lib/beautyMovementRoute";

export const dynamic = "force-dynamic";

/**
 * Read-only authenticated probe for release attestation. Unlike the invite
 * exchange route, this never creates an HttpOnly session or mutates D1 state.
 */
export async function POST(request: NextRequest) {
  if (!(await hasBeautyMovementAllowedOrigin(request))) return beautyMovementInvalidResponse();
  const body = await readBeautyMovementJson(request);
  const token = stringField(body?.token, 256);
  if (!token) return beautyMovementInvalidResponse();

  const result = await probeBeautyMovementCampaignCopy({
    token,
    origin: request.headers.get("origin"),
  });
  if (!result.ok) {
    return result.error === "campaign_unavailable"
      ? beautyMovementUnavailableResponse()
      : beautyMovementInvalidResponse();
  }

  return beautyMovementJson({ ok: true, campaign: result.campaign });
}
