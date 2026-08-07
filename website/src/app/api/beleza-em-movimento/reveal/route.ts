import { NextRequest } from "next/server";
import { revealBeautyMovementCard } from "@/lib/beautyMovementDb";
import { BEAUTY_MOVEMENT_ACTS, getBeautyMovementCardsForAct } from "@/lib/beautyMovementCards";
import {
  beautyMovementInvalidResponse,
  beautyMovementJson,
  beautyMovementUnavailableResponse,
  getBeautyMovementClientIp,
  getBeautyMovementSessionToken,
  hasBeautyMovementAllowedOrigin,
  readBeautyMovementJson,
  stringField,
} from "@/lib/beautyMovementRoute";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await hasBeautyMovementAllowedOrigin(request))) return beautyMovementInvalidResponse();
  const body = await readBeautyMovementJson(request);
  const actIndex = Number(body?.actIndex);
  const cardId = stringField(body?.cardId, 80);
  if (!cardId || !Number.isInteger(actIndex)) return beautyMovementInvalidResponse();

  const result = await revealBeautyMovementCard(
    {
      sessionToken: getBeautyMovementSessionToken(request),
      actIndex,
      cardId,
      origin: request.headers.get("origin"),
      ip: getBeautyMovementClientIp(request),
    },
    {
      cardValidator: ({ palette, actIndex: candidateActIndex, cardId: candidateCardId }) => {
        const act = BEAUTY_MOVEMENT_ACTS[candidateActIndex - 1];
        return Boolean(act && getBeautyMovementCardsForAct(palette, act).some((card) => card.id === candidateCardId));
      },
    },
  );

  if (result.ok) return beautyMovementJson({ ok: true, state: result.state, replay: result.replay === true });
  return result.error === "campaign_unavailable"
    ? beautyMovementUnavailableResponse()
    : beautyMovementInvalidResponse();
}
