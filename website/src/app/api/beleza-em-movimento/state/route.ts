import { NextRequest } from "next/server";
import { getBeautyMovementSession } from "@/lib/beautyMovementDb";
import {
  beautyMovementInvalidResponse,
  beautyMovementJson,
  beautyMovementUnavailableResponse,
  clearBeautyMovementSessionCookie,
  getBeautyMovementSessionToken,
} from "@/lib/beautyMovementRoute";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await getBeautyMovementSession(getBeautyMovementSessionToken(request));
  if (result.ok) return beautyMovementJson({ ok: true, state: result.state });

  const response =
    result.error === "campaign_unavailable"
      ? beautyMovementUnavailableResponse()
      : beautyMovementInvalidResponse();
  clearBeautyMovementSessionCookie(response);
  return response;
}
