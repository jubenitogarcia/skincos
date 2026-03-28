import { NextRequest, NextResponse } from "next/server";
import { CADASTRO_WHEEL_PRIZES } from "@/lib/cadastroWheelPrizes";
import { issueCadastroWheelToken, verifyCadastroWheelToken } from "@/lib/cadastroWheelSecurity";
import { assignCadastroLeadPrize, findCadastroLeadById } from "@/lib/cadastroLeadDb";

const COOKIE_NAME = "ef_cadastro_wheel";
const LEAD_COOKIE_NAME = "ef_cadastro_lead";
const DEFAULT_LOCK_HOURS = 24;
const MAX_LOCK_HOURS = 7 * 24;

export const dynamic = "force-dynamic";

function withNoStore(body: unknown, init?: { status?: number }): NextResponse {
    const response = NextResponse.json(body, { status: init?.status ?? 200 });
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    return response;
}

function clearWheelCookie(response: NextResponse) {
    response.cookies.set({
        name: COOKIE_NAME,
        value: "",
        maxAge: 0,
        path: "/",
    });
}

function resolveSecret(): string | null {
    const secret = (
        process.env.CADASTRO_WHEEL_SECRET ??
        process.env.BOOKING_STATUS_SECRET ??
        process.env.BOOKING_DECISION_SECRET ??
        ""
    ).trim();
    return secret.length > 0 ? secret : null;
}

function resolveLockWindowMs(): number {
    const configuredHours = Number(process.env.CADASTRO_WHEEL_LOCK_HOURS ?? DEFAULT_LOCK_HOURS);
    if (!Number.isFinite(configuredHours) || configuredHours <= 0) {
        return DEFAULT_LOCK_HOURS * 60 * 60 * 1000;
    }
    const safeHours = Math.min(configuredHours, MAX_LOCK_HOURS);
    return Math.round(safeHours * 60 * 60 * 1000);
}

function drawPrizeId(maxPrizeId: number): number {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return (values[0] % maxPrizeId) + 1;
}

async function readLockedPrize(req: NextRequest, secret: string): Promise<{
    status: "none" | "invalid" | "valid";
    prizeId?: number;
    expMs?: number;
}> {
    const leadId = req.cookies.get(LEAD_COOKIE_NAME)?.value ?? "";
    if (leadId) {
        const lead = await findCadastroLeadById(leadId);
        if (lead?.prize_id) {
            return {
                status: "valid",
                prizeId: lead.prize_id,
            };
        }
        if (lead) {
            return { status: "none" };
        }
    }

    const token = req.cookies.get(COOKIE_NAME)?.value ?? "";
    if (!token) return { status: "none" };

    const verification = await verifyCadastroWheelToken({
        secret,
        token,
        maxPrizeId: CADASTRO_WHEEL_PRIZES.length,
    });
    if (!verification.ok) return { status: "invalid" };

    return {
        status: "valid",
        prizeId: verification.prizeId,
        expMs: verification.expMs,
    };
}

export async function GET(req: NextRequest) {
    const secret = resolveSecret();
    if (!secret) {
        return withNoStore({ ok: false, error: "wheel_secret_unavailable" });
    }

    const locked = await readLockedPrize(req, secret);
    if (locked.status === "valid") {
        return withNoStore({
            ok: true,
            locked: true,
            prizeId: locked.prizeId,
            expMs: locked.expMs,
        });
    }

    const response = withNoStore({
        ok: true,
        locked: false,
        prizeId: null,
    });
    if (locked.status === "invalid") {
        clearWheelCookie(response);
    }

    return response;
}

export async function POST(req: NextRequest) {
    const secret = resolveSecret();
    if (!secret) {
        return withNoStore({ ok: false, error: "wheel_secret_unavailable" });
    }

    const locked = await readLockedPrize(req, secret);
    if (locked.status === "valid") {
        return withNoStore({
            ok: true,
            prizeId: locked.prizeId,
            expMs: locked.expMs,
            replay: true,
        });
    }

    const lockWindowMs = resolveLockWindowMs();
    const prizeId = drawPrizeId(CADASTRO_WHEEL_PRIZES.length);
    const expMs = Date.now() + lockWindowMs;
    const leadId = req.cookies.get(LEAD_COOKIE_NAME)?.value ?? "";
    if (leadId) {
        await assignCadastroLeadPrize({ id: leadId, prizeId });
        return withNoStore({
            ok: true,
            prizeId,
            expMs,
            replay: false,
        });
    }

    const token = await issueCadastroWheelToken({ secret, prizeId, expMs });

    const response = withNoStore({
        ok: true,
        prizeId,
        expMs,
        replay: false,
    });
    response.cookies.set({
        name: COOKIE_NAME,
        value: token,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        expires: new Date(expMs),
        maxAge: Math.floor(lockWindowMs / 1000),
    });

    return response;
}
