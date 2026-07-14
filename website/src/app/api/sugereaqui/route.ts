type Payload = {
    token?: string;
    type?: "sugestao" | "reclamacao";
    unit?: string;
    area?: string;
    name?: string;
    message?: string;
    source?: string;
};

function json(data: unknown, init?: ResponseInit) {
    return new Response(JSON.stringify(data), {
        ...init,
        headers: {
            "content-type": "application/json; charset=utf-8",
            ...(init?.headers ?? {}),
        },
    });
}

function clampText(value: string, max: number): string {
    const trimmed = value.trim();
    if (trimmed.length <= max) return trimmed;
    return trimmed.slice(0, max);
}

export async function POST(request: Request) {
    const expectedToken = process.env.SUGEREAQUI_TOKEN;
    if (!expectedToken) {
        return json(
            { ok: false, error: "SUGEREAQUI_TOKEN não configurado no servidor." },
            { status: 500 }
        );
    }

    let body: Payload;
    try {
        body = (await request.json()) as Payload;
    } catch {
        return json({ ok: false, error: "JSON inválido." }, { status: 400 });
    }

    const token = (body.token ?? "").trim();
    if (!token || token !== expectedToken) {
        return json({ ok: false, error: "Código interno inválido." }, { status: 401 });
    }

    const type = body.type === "reclamacao" ? "reclamacao" : "sugestao";
    const unit = clampText(body.unit ?? "", 60);
    const area = clampText(body.area ?? "", 80);
    const name = clampText(body.name ?? "", 80);
    const message = clampText(body.message ?? "", 4000);

    if (!message) {
        return json({ ok: false, error: "Mensagem é obrigatória." }, { status: 400 });
    }

    const ip =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for") ||
        "unknown";
    const ua = request.headers.get("user-agent") || "unknown";

    const entry = {
        kind: "sugereaqui",
        type,
        unit,
        area,
        name,
        message,
        source: clampText(body.source ?? "web", 40),
        meta: {
            ip,
            ua,
            ts: new Date().toISOString(),
        },
    };

    const webhookUrl = process.env.SUGEREAQUI_WEBHOOK_URL;
    if (webhookUrl) {
        try {
            const res = await fetch(webhookUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(entry),
            });

            if (!res.ok) {
                console.log("SUGEREAQUI webhook failed", res.status);
                console.log("SUGEREAQUI payload", entry);
                return json(
                    { ok: true, mode: "log" as const },
                    { status: 200 }
                );
            }

            return json({ ok: true, mode: "webhook" as const }, { status: 200 });
        } catch {
            console.log("SUGEREAQUI webhook error");
            console.log("SUGEREAQUI payload", entry);
            return json({ ok: true, mode: "log" as const }, { status: 200 });
        }
    }

    console.log("SUGEREAQUI payload", entry);
    return json({ ok: true, mode: "log" as const }, { status: 200 });
}
