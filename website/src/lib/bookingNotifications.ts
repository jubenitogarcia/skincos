import { units } from "@/data/units";

type NotificationStatus = "sent" | "skipped" | "failed";

export type NotificationResult = {
    ok: boolean;
    status: NotificationStatus;
    provider?: string;
    error?: string;
};

export type BookingNotificationPayload = {
    id: string;
    unitSlug: string;
    serviceName: string;
    date: string;
    time: string;
    patientName: string;
    email: string;
    whatsapp: string;
};

type SmtpConnect = (options: {
    hostname: string;
    port: number;
    secureTransport?: "on" | "off" | "starttls";
}) => {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    close: () => void;
};

function unitFromSlug(slug: string) {
    return units.find((u) => u.slug === slug);
}

function unitLabelFromSlug(slug: string): string {
    const unit = unitFromSlug(slug);
    return unit?.name ?? slug;
}

function unitEmailFromSlug(slug: string): string | null {
    const unit = unitFromSlug(slug);
    const raw = (unit?.email ?? "").trim();
    if (!raw) return null;
    return raw.replace(/^mailto:/i, "").split("?")[0]?.trim() || null;
}

function formatDatePtBr(dateKey: string): string {
    const [y, m, d] = dateKey.split("-").map((x) => Number(x));
    if (!y || !m || !d) return dateKey;
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function buildEmailText(payload: BookingNotificationPayload) {
    const unitLabel = unitLabelFromSlug(payload.unitSlug);
    const dateLabel = formatDatePtBr(payload.date);
    return [
        `Olá, ${payload.patientName}!`,
        "",
        "Sua reserva foi confirmada.",
        "",
        `Procedimento: ${payload.serviceName}`,
        `Data: ${dateLabel} às ${payload.time}`,
        `Unidade: ${unitLabel}`,
        `Protocolo: ${payload.id}`,
        "",
        "Se precisar alterar, responda este e-mail.",
        "",
        "Espaço Facial",
    ].join("\n");
}

function buildEmailHtml(payload: BookingNotificationPayload) {
    const unitLabel = unitLabelFromSlug(payload.unitSlug);
    const dateLabel = formatDatePtBr(payload.date);
    return `
        <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
            <p>Olá, <strong>${payload.patientName}</strong>!</p>
            <p>Sua reserva foi confirmada.</p>
            <p><strong>Procedimento:</strong> ${payload.serviceName}<br/>
               <strong>Data:</strong> ${dateLabel} às ${payload.time}<br/>
               <strong>Unidade:</strong> ${unitLabel}<br/>
               <strong>Protocolo:</strong> ${payload.id}</p>
            <p>Se precisar alterar, responda este e-mail.</p>
            <p>Espaço Facial</p>
        </div>
    `.trim();
}

function buildWhatsappMessage(payload: BookingNotificationPayload) {
    const unitLabel = unitLabelFromSlug(payload.unitSlug);
    const dateLabel = formatDatePtBr(payload.date);
    return `Reserva confirmada! ${payload.patientName}, seu agendamento de ${payload.serviceName} em ${dateLabel} às ${payload.time} na ${unitLabel} foi confirmado. Protocolo ${payload.id}.`;
}

function sanitizeEmail(value: string): string {
    const email = (value ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
    return email;
}

function sanitizeHeader(value: string): string {
    return (value ?? "").replace(/[\r\n]+/g, " ").trim();
}

async function tryLoadSmtpConnect(): Promise<SmtpConnect | null> {
    try {
        const dynamicImport = new Function("specifier", "return import(specifier);") as (
            specifier: string,
        ) => Promise<unknown>;
        const mod = (await dynamicImport("cloudflare:sockets")) as { connect?: SmtpConnect };
        return typeof mod.connect === "function" ? mod.connect : null;
    } catch {
        return null;
    }
}

function buildSmtpMessage(params: { from: string; to: string; subject: string; text: string; html: string }) {
    const boundary = `ef_${crypto.randomUUID().replace(/-/g, "")}`;
    const lines = [
        `From: ${sanitizeHeader(params.from)}`,
        `To: ${sanitizeHeader(params.to)}`,
        `Subject: ${sanitizeHeader(params.subject)}`,
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        params.text,
        "",
        `--${boundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        params.html,
        "",
        `--${boundary}--`,
        "",
    ];

    return lines
        .join("\r\n")
        .split("\r\n")
        .map((line) => (line.startsWith(".") ? `.${line}` : line))
        .join("\r\n");
}

async function readSmtpResponse(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    state: { buffer: string },
) {
    while (true) {
        const split = state.buffer.split("\r\n");
        if (split.length > 1) {
            const lines = split.slice(0, -1).filter((line) => line.length > 0);
            const tail = split[split.length - 1] ?? "";
            if (lines.length > 0) {
                const last = lines[lines.length - 1] ?? "";
                if (/^\d{3} /.test(last)) {
                    state.buffer = tail;
                    return { code: Number(last.slice(0, 3)) };
                }
            }
        }

        const next = await reader.read();
        if (next.done) throw new Error("smtp_connection_closed");
        state.buffer += decoder.decode(next.value, { stream: true });
    }
}

async function sendSmtpCommand(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    state: { buffer: string },
    command: string,
    expectedCodes: number[],
) {
    await writer.write(new TextEncoder().encode(`${command}\r\n`));
    const response = await readSmtpResponse(reader, decoder, state);
    if (!expectedCodes.includes(response.code)) {
        throw new Error(`smtp_command_failed:${command}:${response.code}`);
    }
}

async function sendTitanEmailDirect(payload: BookingNotificationPayload): Promise<NotificationResult> {
    const connect = await tryLoadSmtpConnect();
    if (!connect) {
        return { ok: false, status: "skipped", error: "smtp_runtime_unavailable" };
    }

    const to = sanitizeEmail(payload.email);
    const from = sanitizeEmail(unitEmailFromSlug(payload.unitSlug) ?? "");
    if (!to || !from) {
        return { ok: false, status: "failed", error: "invalid_email_fields" };
    }

    let user = "";
    let pass = "";
    if (payload.unitSlug === "barrashoppingsul") {
        user = sanitizeEmail(process.env.TITAN_SMTP_USER_BARRA ?? "");
        pass = (process.env.TITAN_SMTP_PASS_BARRA ?? "").trim();
    } else if (payload.unitSlug === "novo-hamburgo") {
        user = sanitizeEmail(process.env.TITAN_SMTP_USER_NH ?? "");
        pass = (process.env.TITAN_SMTP_PASS_NH ?? "").trim();
    }

    if (!user || !pass) {
        return { ok: false, status: "skipped", error: "smtp_not_configured_for_unit" };
    }

    const host = (process.env.TITAN_SMTP_HOST ?? "smtp.titan.email").trim();
    const portRaw = Number((process.env.TITAN_SMTP_PORT ?? "465").trim() || 465);
    const port = Number.isFinite(portRaw) ? portRaw : 465;

    const socket = connect({
        hostname: host,
        port,
        secureTransport: "on",
    });

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const decoder = new TextDecoder();
    const state = { buffer: "" };

    try {
        const greeting = await readSmtpResponse(reader, decoder, state);
        if (greeting.code !== 220) {
            throw new Error(`smtp_greeting_failed:${greeting.code}`);
        }

        await sendSmtpCommand(writer, reader, decoder, state, "EHLO espacofacial.com", [250]);
        await sendSmtpCommand(writer, reader, decoder, state, "AUTH LOGIN", [334]);
        await sendSmtpCommand(writer, reader, decoder, state, btoa(user), [334]);
        await sendSmtpCommand(writer, reader, decoder, state, btoa(pass), [235]);
        await sendSmtpCommand(writer, reader, decoder, state, `MAIL FROM:<${from}>`, [250]);
        await sendSmtpCommand(writer, reader, decoder, state, `RCPT TO:<${to}>`, [250, 251]);
        await sendSmtpCommand(writer, reader, decoder, state, "DATA", [354]);

        const message = buildSmtpMessage({
            from,
            to,
            subject: "Confirmação de agendamento — Espaço Facial",
            text: buildEmailText(payload),
            html: buildEmailHtml(payload),
        });
        await writer.write(new TextEncoder().encode(`${message}\r\n.\r\n`));

        const dataResponse = await readSmtpResponse(reader, decoder, state);
        if (dataResponse.code !== 250) {
            throw new Error(`smtp_data_failed:${dataResponse.code}`);
        }

        await sendSmtpCommand(writer, reader, decoder, state, "QUIT", [221]);
        return { ok: true, status: "sent", provider: "titan_smtp" };
    } catch (error) {
        return {
            ok: false,
            status: "failed",
            provider: "titan_smtp",
            error: error instanceof Error ? error.message : "smtp_send_failed",
        };
    } finally {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
    }
}

async function postJson(url: string, body: unknown, headers?: Record<string, string>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", ...(headers ?? {}) },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        return { ok: res.ok, status: res.status, text: await res.text().catch(() => "") };
    } catch (error) {
        return { ok: false, status: 0, text: error instanceof Error ? error.message : "request_failed" };
    } finally {
        clearTimeout(timeout);
    }
}

export async function sendBookingEmail(payload: BookingNotificationPayload): Promise<NotificationResult> {
    const to = payload.email;
    const smtpResult = await sendTitanEmailDirect(payload);
    if (smtpResult.ok) return smtpResult;

    const envFrom = (process.env.BOOKING_EMAIL_FROM ?? "").trim();
    const unitFrom = unitEmailFromSlug(payload.unitSlug) ?? "";
    const from = envFrom || unitFrom;
    const resendKey = (process.env.RESEND_API_KEY ?? "").trim();
    const webhookUrl = (process.env.BOOKING_EMAIL_WEBHOOK_URL ?? "").trim();

    if (!to) return { ok: false, status: "skipped", error: "missing_to" };
    if (resendKey && from) {
        const res = await postJson(
            "https://api.resend.com/emails",
            {
                from,
                to,
                subject: "Confirmação de agendamento — Espaço Facial",
                html: buildEmailHtml(payload),
                text: buildEmailText(payload),
            },
            { Authorization: `Bearer ${resendKey}` },
        );
        return res.ok
            ? { ok: true, status: "sent", provider: "resend" }
            : { ok: false, status: "failed", provider: "resend", error: res.text || "send_failed" };
    }

    if (webhookUrl) {
        const secret = (process.env.BOOKING_EMAIL_WEBHOOK_SECRET ?? "").trim();
        const res = await postJson(
            webhookUrl,
            {
                to,
                from,
                subject: "Confirmação de agendamento — Espaço Facial",
                text: buildEmailText(payload),
                html: buildEmailHtml(payload),
                bookingId: payload.id,
                unitSlug: payload.unitSlug,
            },
            secret ? { "x-booking-webhook-secret": secret } : undefined,
        );
        return res.ok
            ? { ok: true, status: "sent", provider: "webhook" }
            : { ok: false, status: "failed", provider: "webhook", error: res.text || "send_failed" };
    }

    return {
        ok: false,
        status: "skipped",
        error: smtpResult.error === "smtp_runtime_unavailable" ? "not_configured" : smtpResult.error ?? "not_configured",
    };
}

export async function sendBookingWhatsappPrep(payload: BookingNotificationPayload): Promise<NotificationResult> {
    const webhookUrl = (process.env.BOOKING_WHATSAPP_WEBHOOK_URL ?? "").trim();
    if (!webhookUrl) return { ok: false, status: "skipped", error: "not_configured" };

    const secret = (process.env.BOOKING_WHATSAPP_WEBHOOK_SECRET ?? "").trim();
    const res = await postJson(
        webhookUrl,
        {
            to: payload.whatsapp,
            message: buildWhatsappMessage(payload),
            bookingId: payload.id,
            unitSlug: payload.unitSlug,
        },
        secret ? { "x-booking-webhook-secret": secret } : undefined,
    );

    return res.ok
        ? { ok: true, status: "sent", provider: "webhook" }
        : { ok: false, status: "failed", provider: "webhook", error: res.text || "send_failed" };
}

export async function sendBookingNotifications(payload: BookingNotificationPayload) {
    const [email, whatsapp] = await Promise.all([sendBookingEmail(payload), sendBookingWhatsappPrep(payload)]);
    return { email, whatsapp };
}
