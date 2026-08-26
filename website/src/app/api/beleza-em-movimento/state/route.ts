import { NextRequest } from "next/server";
import { getBeautyMovementSession } from "@/lib/beautyMovementDb";
import {
  beautyMovementInvalidResponse,
  beautyMovementJson,
  beautyMovementUnavailableResponse,
  clearBeautyMovementLegacySessionCookie,
  clearBeautyMovementSessionCookie,
  getBeautyMovementSessionCredential,
} from "@/lib/beautyMovementRoute";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const credential = getBeautyMovementSessionCredential(request);
  const result = await getBeautyMovementSession(credential);
  if (result.ok) return beautyMovementJson({ ok: true, state: result.state });

  const response =
    result.error === "campaign_unavailable"
      ? beautyMovementUnavailableResponse()
      : beautyMovementInvalidResponse();
  if (credential) clearBeautyMovementSessionCookie(response, credential.contextRef);
  clearBeautyMovementLegacySessionCookie(response);
  return response;
}
