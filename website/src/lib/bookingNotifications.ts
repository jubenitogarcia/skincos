import { units } from "@/data/units";
import { BOOKING_CONFIRMATION_EMAIL_TEMPLATE } from "@/lib/emailTemplates/bookingConfirmationTemplate";

type NotificationStatus = "sent" | "skipped" | "failed";
export type PatientGender = "male" | "female" | "unspecified";

export type NotificationResult = {
    ok: boolean;
    status: NotificationStatus;
    provider?: string;
    error?: string;
};

export type BookingNotificationPayload = {
    id: string;
    unitSlug: string;
    procedureName: string;
    date: string;
    time: string;
    patientName: string;
    patientGender: PatientGender;
    email: string;
    whatsapp: string;
    cpf?: string;
    address?: string;
    doctorName?: string;
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

function stripPhoneToDigits(value: string): string {
    return (value ?? "").replace(/\D/g, "");
}

function formatWhatsappDisplay(value: string): string {
    const digitsRaw = stripPhoneToDigits(value);
    const digits = digitsRaw.startsWith("55") ? digitsRaw.slice(2) : digitsRaw;
    const ddd = digits.slice(0, 2);
    const prefix = digits.slice(2, 7);
    const suffix = digits.slice(7, 11);
    if (!ddd || !prefix || !suffix) return value || "";
    return `+55 (${ddd}) ${prefix}-${suffix}`;
}

function parseInstagramLabel(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const handle = pathname.split("/").filter(Boolean)[0] ?? "";
        return handle ? `@${handle.replace(/^@/, "")}` : "Instagram";
    } catch {
        return "Instagram";
    }
}

function parseFacebookLabel(url: string): string {
    try {
        const parsed = new URL(url);
        const path = parsed.pathname.replace(/\/$/, "");
        return `${parsed.hostname}${path}`;
    } catch {
        return "Facebook";
    }
}

function resolveSiteUrl(): string {
    const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.BOOKING_SITE_URL ?? "https://espacofacial.com").trim();
    return raw.replace(/\/$/, "");
}

function absoluteUrl(siteUrl: string, raw: string): string {
    const value = (raw ?? "").trim();
    if (!value) return siteUrl;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("/")) return `${siteUrl}${value}`;
    return `${siteUrl}/${value}`;
}

function sanitizeUrl(value: string, fallback: string): string {
    const raw = (value ?? "").trim();
    if (!raw) return fallback;
    if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;
    return fallback;
}

function ambassadorForGender(gender: PatientGender, siteUrl: string): { name: string; imageUrl: string } {
    const male = {
        name: "Márcio Garcia",
        imageUrl: absoluteUrl(
            siteUrl,
            process.env.BOOKING_EMAIL_AMBASSADOR_MALE_IMAGE_URL ?? "/images/email/ambassadors/marcio-garcia-u3a7227.jpg",
        ),
    };
    const female = {
        name: "Deborah Secco",
        imageUrl: absoluteUrl(
            siteUrl,
            process.env.BOOKING_EMAIL_AMBASSADOR_FEMALE_IMAGE_URL ?? "/images/email/ambassadors/deborah-secco-20244437.jpeg",
        ),
    };
    return gender === "male" ? male : female;
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

function buildCustomerEmailHtml(payload: BookingNotificationPayload) {
    const siteUrl = resolveSiteUrl();
    const unit = unitFromSlug(payload.unitSlug);
    const unitName = unit?.name ?? payload.unitSlug;
    const unitAddress = [unit?.addressLine ?? "", unit?.state ? `- ${unit.state}` : ""].filter(Boolean).join(" ").trim() || unitName;

    const instagramUrl = sanitizeUrl(unit?.instagram ?? "", `${siteUrl}/`);
    const facebookUrl = sanitizeUrl(unit?.facebook ?? "", `${siteUrl}/`);
    const whatsappDigits = stripPhoneToDigits(unit?.whatsappPhone ?? payload.whatsapp);
    const whatsappUrl = sanitizeUrl(
        whatsappDigits ? `https://api.whatsapp.com/send?phone=${whatsappDigits}` : "",
        `${siteUrl}/`,
    );

    const teamContactUrl = sanitizeUrl(
        unit?.contactUrl ? absoluteUrl(siteUrl, unit.contactUrl) : whatsappUrl,
        whatsappUrl,
    );
    const reservationDetailsUrl = sanitizeUrl(
        `${siteUrl}/agendamento?protocolo=${encodeURIComponent(payload.id)}#booking-flow`,
        `${siteUrl}/agendamento`,
    );

    const ambassador = ambassadorForGender(payload.patientGender, siteUrl);
    const logoUrl = sanitizeUrl(
        absoluteUrl(siteUrl, process.env.BOOKING_EMAIL_LOGO_URL ?? "/logo.png"),
        `${siteUrl}/logo.png`,
    );

    return renderTemplate(BOOKING_CONFIRMATION_EMAIL_TEMPLATE, {
        customer_gender: payload.patientGender,
        customer_name: escapeHtml(payload.patientName),
        procedure_name: escapeHtml(payload.procedureName),
        appointment_date: escapeHtml(formatDatePtBr(payload.date)),
        appointment_time: escapeHtml(payload.time),
        unit_name: escapeHtml(unitName),
        reservation_code: escapeHtml(payload.id),
        ambassador_name: escapeHtml(ambassador.name),
        ambassador_image_url: escapeHtml(sanitizeUrl(ambassador.imageUrl, `${siteUrl}/logo.png`)),
        logo_url: escapeHtml(logoUrl),
        reservation_details_url: escapeHtml(reservationDetailsUrl),
        team_contact_url: escapeHtml(teamContactUrl),
        unit_instagram_url: escapeHtml(instagramUrl),
        unit_instagram: escapeHtml(parseInstagramLabel(instagramUrl)),
        unit_facebook_url: escapeHtml(facebookUrl),
        unit_facebook: escapeHtml(parseFacebookLabel(facebookUrl)),
        unit_whatsapp_url: escapeHtml(whatsappUrl),
        unit_whatsapp: escapeHtml(formatWhatsappDisplay(unit?.whatsappPhone ?? payload.whatsapp)),
        unit_address: escapeHtml(unitAddress),
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
        user = sanitizeEmail(process.env.TITAN_SMTP_USER_BARRA ?? "");
        pass = (process.env.TITAN_SMTP_PASS_BARRA ?? "").trim();
    } else if (params.unitSlug === "novo-hamburgo") {
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
    const envFrom = sanitizeEmail(process.env.BOOKING_EMAIL_FROM ?? "");
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

    const resendKey = (process.env.RESEND_API_KEY ?? "").trim();
    const webhookUrl = (process.env.BOOKING_EMAIL_WEBHOOK_URL ?? "").trim();

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
        const secret = (process.env.BOOKING_EMAIL_WEBHOOK_SECRET ?? "").trim();
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

export async function sendBookingEmail(payload: BookingNotificationPayload): Promise<NotificationResult> {
    return sendEmail({
        unitSlug: payload.unitSlug,
        to: payload.email,
        subject: "Confirmação de agendamento — Espaço Facial",
        text: buildCustomerEmailText(payload),
        html: buildCustomerEmailHtml(payload),
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
    const [email, whatsapp, unitEmail] = await Promise.all([
        sendBookingEmail(payload),
        sendBookingWhatsappPrep(payload),
        sendBookingUnitEmail(payload),
    ]);
    return { email, whatsapp, unitEmail };
}
