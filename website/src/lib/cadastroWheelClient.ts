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

export async function claimCadastroWheelPrize(fetcher: WheelFetch = fetch): Promise<CadastroWheelClaim | null> {
    try {
        const response = await fetcher("/api/cadastro/wheel", {
            method: "POST",
            cache: "no-store",
        });
        if (!response.ok) return null;

        const payload = (await response.json().catch(() => null)) as WheelSpinResponse | null;
        if (payload?.ok && typeof payload.prizeId === "number") {
            const prize = findPrizeById(payload.prizeId);
            if (prize) {
                return { prize, replay: payload.replay };
            }
        }
    } catch {
        // A prize is only awarded after a successful server response.
    }

    return null;
}
