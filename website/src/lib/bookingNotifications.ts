import { units } from "@/data/units";
import { BOOKING_CONFIRMATION_EMAIL_TEMPLATE } from "@/lib/emailTemplates/bookingConfirmationTemplate";
import {
    buildBookingConfirmationViewModel,
    formatDatePtBr,
    type BookingConfirmationPayload,
    type PatientGender,
} from "@/lib/bookingConfirmationView";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";

export type { PatientGender } from "@/lib/bookingConfirmationView";

type NotificationStatus = "sent" | "skipped" | "failed";

export type NotificationResult = {
    ok: boolean;
    status: NotificationStatus;
    provider?: string;
    error?: string;
};

export type BookingNotificationPayload = BookingConfirmationPayload & {
    cpf?: string;
    address?: string;
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

function sanitizeEmail(value: string): string {
    const email = (value ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
    return email;
}

function sanitizeHeader(value: string): string {
    return (value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value: string): string {
    return (value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function resolveSiteUrl(): string {
    const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.BOOKING_SITE_URL ?? "https://espacofacial.com").trim();
    return raw.replace(/\/$/, "");
}

function formatGenderLabel(gender: PatientGender): string {
    if (gender === "male") return "Masculino";
    if (gender === "female") return "Feminino";
    return "Prefiro não informar";
}

function renderTemplate(rawTemplate: string, placeholders: Record<string, string>): string {
    return rawTemplate.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => placeholders[key] ?? "");
}

function buildCustomerEmailText(payload: BookingNotificationPayload) {
    const unitLabel = unitLabelFromSlug(payload.unitSlug);
    const dateLabel = formatDatePtBr(payload.date);
    return [
        `Olá, ${payload.patientName}!`,
        "",
        "Sua reserva foi confirmada.",
        "",
        `Procedimento: ${payload.procedureName}`,
        `Data: ${dateLabel} às ${payload.time}`,
        `Unidade: ${unitLabel}`,
        `Protocolo: ${payload.id}`,
        "",
        "Se precisar alterar, fale com a equipe da unidade.",
        "",
        "Espaço Facial",
    ].join("\n");
}

async function buildCustomerEmailHtml(payload: BookingNotificationPayload) {
    const siteUrl = resolveSiteUrl();
    const [logoUrl, maleAmbassadorImageUrl, femaleAmbassadorImageUrl] = await Promise.all([
        getRuntimeSecret("BOOKING_EMAIL_LOGO_URL"),
        getRuntimeSecret("BOOKING_EMAIL_AMBASSADOR_MALE_IMAGE_URL"),
        getRuntimeSecret("BOOKING_EMAIL_AMBASSADOR_FEMALE_IMAGE_URL"),
    ]);
    const confirmation = buildBookingConfirmationViewModel(payload, {
        siteUrl,
        logoUrl: logoUrl || "/logo.png",
        maleAmbassadorImageUrl: maleAmbassadorImageUrl || "/images/email/ambassadors/marcio-garcia-u3a7227.jpg",
        femaleAmbassadorImageUrl: femaleAmbassadorImageUrl || "/images/email/ambassadors/deborah-secco-20244437.jpeg",
        reservationDetailsUrl: `${siteUrl}/agendamento#booking-flow`,
    });

    return renderTemplate(BOOKING_CONFIRMATION_EMAIL_TEMPLATE, {
        customer_gender: payload.patientGender,
        customer_name: escapeHtml(confirmation.customerName),
        procedure_name: escapeHtml(confirmation.procedureName),
        appointment_date: escapeHtml(confirmation.appointmentDate),
        appointment_time: escapeHtml(confirmation.appointmentTime),
        unit_name: escapeHtml(confirmation.unitName),
        reservation_code: escapeHtml(confirmation.reservationCode),
        ambassador_name: escapeHtml(confirmation.ambassadorName),
        ambassador_image_url: escapeHtml(confirmation.ambassadorImageUrl),
        logo_url: escapeHtml(confirmation.logoUrl),
        reservation_details_url: escapeHtml(confirmation.reservationDetailsUrl),
        team_contact_url: escapeHtml(confirmation.teamContactUrl),
        unit_instagram_url: escapeHtml(confirmation.unitInstagramUrl),
        unit_instagram: escapeHtml(confirmation.unitInstagramLabel),
        unit_facebook_url: escapeHtml(confirmation.unitFacebookUrl),
        unit_facebook: escapeHtml(confirmation.unitFacebookLabel),
        unit_whatsapp_url: escapeHtml(confirmation.unitWhatsappUrl),
        unit_whatsapp: escapeHtml(confirmation.unitWhatsappLabel),
        unit_address: escapeHtml(confirmation.unitAddress),
    });
}

function buildUnitEmailText(payload: BookingNotificationPayload) {
    const unitLabel = unitLabelFromSlug(payload.unitSlug);
    const dateLabel = formatDatePtBr(payload.date);
    const genderLabel = formatGenderLabel(payload.patientGender);

    return [
        "Nova reserva confirmada no site.",
        "",
        `Unidade: ${unitLabel}`,
        `Protocolo: ${payload.id}`,
        `Paciente: ${payload.patientName}`,
        `Gênero: ${genderLabel}`,
        `Procedimento: ${payload.procedureName}`,
        `Data: ${dateLabel}`,
        `Horário: ${payload.time}`,
        `E-mail: ${payload.email}`,
        `WhatsApp: ${payload.whatsapp}`,
        payload.cpf ? `CPF: ${payload.cpf}` : "",
        payload.address ? `Endereço: ${payload.address}` : "",
        payload.doctorName ? `Profissional: ${payload.doctorName}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

function buildUnitEmailHtml(payload: BookingNotificationPayload) {
    const unitLabel = unitLabelFromSlug(payload.unitSlug);
    const dateLabel = formatDatePtBr(payload.date);
    const genderLabel = formatGenderLabel(payload.patientGender);

    return `
        <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
            <h2 style="margin: 0 0 12px 0;">Nova reserva confirmada no site</h2>
            <p style="margin: 0 0 8px 0;"><strong>Unidade:</strong> ${escapeHtml(unitLabel)}</p>
            <p style="margin: 0 0 8px 0;"><strong>Protocolo:</strong> ${escapeHtml(payload.id)}</p>
            <p style="margin: 0 0 8px 0;"><strong>Paciente:</strong> ${escapeHtml(payload.patientName)}</p>
            <p style="margin: 0 0 8px 0;"><strong>Gênero:</strong> ${escapeHtml(genderLabel)}</p>
            <p style="margin: 0 0 8px 0;"><strong>Procedimento:</strong> ${escapeHtml(payload.procedureName)}</p>
            <p style="margin: 0 0 8px 0;"><strong>Data:</strong> ${escapeHtml(dateLabel)} às ${escapeHtml(payload.time)}</p>
            <p style="margin: 0 0 8px 0;"><strong>E-mail:</strong> ${escapeHtml(payload.email)}</p>
            <p style="margin: 0 0 8px 0;"><strong>WhatsApp:</strong> ${escapeHtml(payload.whatsapp)}</p>
            ${payload.cpf ? `<p style="margin: 0 0 8px 0;"><strong>CPF:</strong> ${escapeHtml(payload.cpf)}</p>` : ""}
            ${payload.address ? `<p style="margin: 0 0 8px 0;"><strong>Endereço:</strong> ${escapeHtml(payload.address)}</p>` : ""}
            ${payload.doctorName ? `<p style="margin: 0 0 8px 0;"><strong>Profissional:</strong> ${escapeHtml(payload.doctorName)}</p>` : ""}
        </div>
    `.trim();
}

function buildWhatsappMessage(payload: BookingNotificationPayload) {
    const unitLabel = unitLabelFromSlug(payload.unitSlug);
    const dateLabel = formatDatePtBr(payload.date);
    return `Reserva confirmada! ${payload.patientName}, seu agendamento de ${payload.procedureName} em ${dateLabel} às ${payload.time} na ${unitLabel} foi confirmado. Protocolo ${payload.id}.`;
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

async function sendTitanEmailDirect(params: {
    unitSlug: string;
    to: string;
    from: string;
    subject: string;
    text: string;
    html: string;
}): Promise<NotificationResult> {
    const connect = await tryLoadSmtpConnect();
    if (!connect) {
        return { ok: false, status: "skipped", error: "smtp_runtime_unavailable" };
    }

    const to = sanitizeEmail(params.to);
    const from = sanitizeEmail(params.from);
    if (!to || !from) {
        return { ok: false, status: "failed", error: "invalid_email_fields" };
    }

    let user = "";
    let pass = "";
    if (params.unitSlug === "barrashoppingsul") {
        user = sanitizeEmail(await getRuntimeSecret("TITAN_SMTP_USER_BARRA"));
        pass = await getRuntimeSecret("TITAN_SMTP_PASS_BARRA");
    } else if (params.unitSlug === "novo-hamburgo") {
        user = sanitizeEmail(await getRuntimeSecret("TITAN_SMTP_USER_NH"));
        pass = await getRuntimeSecret("TITAN_SMTP_PASS_NH");
    }

    if (!user || !pass) {
        return { ok: false, status: "skipped", error: "smtp_not_configured_for_unit" };
    }

    const host = (await getRuntimeSecret("TITAN_SMTP_HOST")) || "smtp.titan.email";
    const portRaw = Number((await getRuntimeSecret("TITAN_SMTP_PORT")) || 465);
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
            subject: params.subject,
            text: params.text,
            html: params.html,
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

function isEvolutionSendTextUrl(value: string): boolean {
    const raw = (value ?? "").trim();
    if (!raw) return false;
    try {
        const parsed = new URL(raw);
        return /\/message\/sendText\/[^/]+\/?$/i.test(parsed.pathname);
    } catch {
        return /\/message\/sendText\/[^/]+\/?$/i.test(raw);
    }
}

async function sendEmail(params: {
    unitSlug: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    kind: "customer_confirmation" | "unit_confirmation";
}): Promise<NotificationResult> {
    const to = sanitizeEmail(params.to);
    const unitFrom = sanitizeEmail(unitEmailFromSlug(params.unitSlug) ?? "");
    const envFrom = sanitizeEmail(await getRuntimeSecret("BOOKING_EMAIL_FROM"));
    const from = envFrom || unitFrom;

    if (!to) return { ok: false, status: "skipped", error: "missing_to" };

    const smtpResult: NotificationResult = from
        ? await sendTitanEmailDirect({
            unitSlug: params.unitSlug,
            to,
            from,
            subject: params.subject,
            text: params.text,
            html: params.html,
        })
        : { ok: false, status: "skipped", error: "missing_from" };
    if (smtpResult.ok) return smtpResult;

    const [resendKey, webhookUrl, webhookSecret] = await Promise.all([
        getRuntimeSecret("RESEND_API_KEY"),
        getRuntimeSecret("BOOKING_EMAIL_WEBHOOK_URL"),
        getRuntimeSecret("BOOKING_EMAIL_WEBHOOK_SECRET"),
    ]);

    if (resendKey && from) {
        const res = await postJson(
            "https://api.resend.com/emails",
            {
                from,
                to,
                subject: params.subject,
                html: params.html,
                text: params.text,
            },
            { Authorization: `Bearer ${resendKey}` },
        );
        return res.ok
            ? { ok: true, status: "sent", provider: "resend" }
            : { ok: false, status: "failed", provider: "resend", error: res.text || "send_failed" };
    }

    if (webhookUrl) {
        const res = await postJson(
            webhookUrl,
            {
                to,
                from,
                subject: params.subject,
                text: params.text,
                html: params.html,
                unitSlug: params.unitSlug,
                kind: params.kind,
            },
            webhookSecret ? { "x-booking-webhook-secret": webhookSecret } : undefined,
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

export async function sendBookingEmail(payload: BookingNotificationPayload): Promise<NotificationResult> {
    const html = await buildCustomerEmailHtml(payload);
    return sendEmail({
        unitSlug: payload.unitSlug,
        to: payload.email,
        subject: "Confirmação de agendamento — Espaço Facial",
        text: buildCustomerEmailText(payload),
        html,
        kind: "customer_confirmation",
    });
}

export async function sendBookingUnitEmail(payload: BookingNotificationPayload): Promise<NotificationResult> {
    const to = sanitizeEmail(unitEmailFromSlug(payload.unitSlug) ?? "");
    if (!to) {
        return { ok: false, status: "skipped", error: "missing_unit_email" };
    }

    return sendEmail({
        unitSlug: payload.unitSlug,
        to,
        subject: `Nova reserva confirmada — ${unitLabelFromSlug(payload.unitSlug)}`,
        text: buildUnitEmailText(payload),
        html: buildUnitEmailHtml(payload),
        kind: "unit_confirmation",
    });
}

export async function sendBookingWhatsappPrep(payload: BookingNotificationPayload): Promise<NotificationResult> {
    const [webhookUrl, webhookSecret] = await Promise.all([
        getRuntimeSecret("BOOKING_WHATSAPP_WEBHOOK_URL"),
        getRuntimeSecret("BOOKING_WHATSAPP_WEBHOOK_SECRET"),
    ]);
    if (!webhookUrl) return { ok: false, status: "skipped", error: "not_configured" };
    const useEvolutionDirect = isEvolutionSendTextUrl(webhookUrl);
    const res = await postJson(
        webhookUrl,
        useEvolutionDirect
            ? {
                number: payload.whatsapp.replace(/\D/g, ""),
                text: buildWhatsappMessage(payload),
            }
            : {
                to: payload.whatsapp,
                message: buildWhatsappMessage(payload),
                bookingId: payload.id,
                unitSlug: payload.unitSlug,
            },
        webhookSecret
            ? useEvolutionDirect
                ? { apikey: webhookSecret }
                : { "x-booking-webhook-secret": webhookSecret }
            : undefined,
    );

    return res.ok
        ? { ok: true, status: "sent", provider: useEvolutionDirect ? "evolution_api" : "webhook" }
        : { ok: false, status: "failed", provider: useEvolutionDirect ? "evolution_api" : "webhook", error: res.text || "send_failed" };
}

export async function sendBookingNotifications(payload: BookingNotificationPayload) {
    const [email, whatsapp, unitEmail] = await Promise.all([
        sendBookingEmail(payload),
        sendBookingWhatsappPrep(payload),
        sendBookingUnitEmail(payload),
    ]);
    return { email, whatsapp, unitEmail };
}
