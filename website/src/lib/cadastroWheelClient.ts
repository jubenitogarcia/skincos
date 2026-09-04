import { CADASTRO_WHEEL_PRIZES, type CadastroPrize } from "./cadastroWheelPrizes";

type WheelStatusResponse =
    | { ok: true; locked: true; prizeId: number; expMs?: number }
    | { ok: true; locked: false; prizeId: null }
    | { ok: false; error: string };

type WheelSpinResponse =
    | { ok: true; prizeId: number; replay: boolean; expMs?: number }
    | { ok: false; error: string };

type WheelFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type CadastroWheelClaim = {
    prize: CadastroPrize;
    replay: boolean;
};

export type CadastroWheelClaimResult =
    | {
          ok: true;
          claim: CadastroWheelClaim;
      }
    | {
          ok: false;
          error: "claim_unavailable" | "lead_unavailable";
      };

function findPrizeById(prizeId: number): CadastroPrize | null {
    return CADASTRO_WHEEL_PRIZES.find((prize) => prize.id === prizeId) ?? null;
}

export async function fetchLockedCadastroWheelPrize(fetcher: WheelFetch = fetch): Promise<CadastroPrize | null> {
    try {
        const response = await fetcher("/api/cadastro/wheel", {
            method: "GET",
            cache: "no-store",
        });
        if (!response.ok) return null;

        const payload = (await response.json().catch(() => null)) as WheelStatusResponse | null;
        if (payload?.ok && payload.locked && typeof payload.prizeId === "number") {
            return findPrizeById(payload.prizeId);
        }
    } catch {
        // A prize is only restored from the signed server response.
    }

    return null;
}

export async function claimCadastroWheelPrize(fetcher: WheelFetch = fetch): Promise<CadastroWheelClaimResult> {
    try {
        const response = await fetcher("/api/cadastro/wheel", {
            method: "POST",
            cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as WheelSpinResponse | null;
        if (payload && !payload.ok && payload.error === "lead_unavailable") {
            return { ok: false, error: "lead_unavailable" };
        }
        if (!response.ok) return { ok: false, error: "claim_unavailable" };

        if (payload?.ok && typeof payload.prizeId === "number") {
            const prize = findPrizeById(payload.prizeId);
            if (prize) {
                return {
                    ok: true,
                    claim: { prize, replay: payload.replay },
                };
            }
        }
    } catch {
        // A prize is only awarded after a successful server response.
    }

    return { ok: false, error: "claim_unavailable" };
}
