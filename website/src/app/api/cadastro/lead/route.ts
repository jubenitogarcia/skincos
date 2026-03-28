import { NextRequest, NextResponse } from "next/server";
import {
    createCadastroLead,
    findCadastroLeadByIdentity,
    normalizeCadastroLeadInput,
    touchCadastroLead,
} from "@/lib/cadastroLeadDb";

const LEAD_COOKIE_NAME = "ef_cadastro_lead";

export const dynamic = "force-dynamic";

function withNoStore(body: unknown, init?: { status?: number }): NextResponse {
    const response = NextResponse.json(body, { status: init?.status ?? 200 });
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    return response;
}

function setLeadCookie(response: NextResponse, leadId: string) {
    response.cookies.set({
        name: LEAD_COOKIE_NAME,
        value: leadId,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
    });
}

export async function POST(req: NextRequest) {
    const raw = (await req.json().catch(() => null)) as
        | { fullName?: string; email?: string; phone?: string; unitSlug?: string | null }
        | null;

    const payload = normalizeCadastroLeadInput({
        fullName: raw?.fullName,
        email: raw?.email,
        phone: raw?.phone,
        unitSlug: raw?.unitSlug,
    });

    if (!payload.fullName || payload.fullName.split(/\s+/).filter((part) => part.length >= 2).length < 2) {
        return withNoStore({ ok: false, error: "invalid_full_name" }, { status: 400 });
    }
    if (!payload.email) {
        return withNoStore({ ok: false, error: "invalid_email" }, { status: 400 });
    }
    if (!payload.phone) {
        return withNoStore({ ok: false, error: "invalid_phone" }, { status: 400 });
    }

    const existing = await findCadastroLeadByIdentity({ email: payload.email, phone: payload.phone });
    if (existing) {
        await touchCadastroLead({
            id: existing.id,
            fullName: payload.fullName,
            email: payload.email,
            phone: payload.phone,
            unitSlug: payload.unitSlug,
        });

        const response = withNoStore({
            ok: true,
            duplicate: existing.prize_id !== null,
            leadId: existing.id,
            prizeId: existing.prize_id,
        });
        setLeadCookie(response, existing.id);
        return response;
    }

    const created = await createCadastroLead({
        fullName: payload.fullName,
        email: payload.email,
        phone: payload.phone,
        unitSlug: payload.unitSlug,
    });

    const response = withNoStore({
        ok: true,
        duplicate: false,
        leadId: created.id,
        prizeId: null,
    });
    setLeadCookie(response, created.id);
    return response;
}
