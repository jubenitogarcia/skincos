import { units } from "@/data/units";
import { BOOKING_CONFIRMATION_EMAIL_TEMPLATE } from "@/lib/emailTemplates/bookingConfirmationTemplate";
import {
    absoluteUrl,
    buildBookingConfirmationViewModel,
    formatDatePtBr,
    type BookingConfirmationPayload,
    type PatientGender,
} from "@/lib/bookingConfirmationView";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";
import { connect as tlsConnect, TLSSocket } from "node:tls";

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
    statusToken?: string | null;
};

type SmtpSocket = {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    close: () => void;
    startTls?: () => unknown;
};

type SmtpConnect = (options: {
    hostname: string;
    port: number;
    secureTransport?: "on" | "off" | "starttls";
}) => SmtpSocket;

let smtpConnectLoader: Promise<SmtpConnect | null> | null = null;
const SMTP_STEP_TIMEOUT_MS = 8_000;

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

function buildReservationDetailsUrl(siteUrl: string, payload: Pick<BookingNotificationPayload, "id" | "statusToken" | "unitSlug">): string {
    const url = new URL("/agendamento", siteUrl);
    url.searchParams.set("booking", payload.id);
    if (payload.unitSlug) {
        url.searchParams.set("unit", payload.unitSlug);
    }
    if (payload.statusToken) {
        url.searchParams.set("statusToken", payload.statusToken);
    }
    url.hash = "booking-flow";
    return url.toString();
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
    const detailsUrl = buildReservationDetailsUrl(resolveSiteUrl(), payload);
    return [
        `Olá, ${payload.patientName}!`,
        "",
        "Sua reserva foi confirmada.",
        "",
        `Procedimento: ${payload.procedureName}`,
        `Data: ${dateLabel} às ${payload.time}`,
        `Unidade: ${unitLabel}`,
        "",
        `Ver detalhes da reserva: ${detailsUrl}`,
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
        reservationDetailsUrl: buildReservationDetailsUrl(siteUrl, payload),
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
        footer_logo_url: escapeHtml(absoluteUrl(siteUrl, "/logo-white.png")),
        reservation_details_url: escapeHtml(confirmation.reservationDetailsUrl),
        team_contact_url: escapeHtml(confirmation.teamContactUrl),
        unit_instagram_url: escapeHtml(confirmation.unitInstagramUrl),
        unit_instagram: escapeHtml(confirmation.unitInstagramLabel),
        unit_instagram_icon_url: escapeHtml(absoluteUrl(siteUrl, "/images/email/social/instagram-white.svg")),
        unit_facebook_url: escapeHtml(confirmation.unitFacebookUrl),
        unit_facebook: escapeHtml(confirmation.unitFacebookLabel),
        unit_facebook_icon_url: escapeHtml(absoluteUrl(siteUrl, "/images/email/social/facebook-white.svg")),
        unit_whatsapp_url: escapeHtml(confirmation.unitWhatsappUrl),
        unit_whatsapp: escapeHtml(confirmation.unitWhatsappLabel),
        unit_whatsapp_icon_url: escapeHtml(absoluteUrl(siteUrl, "/images/email/social/whatsapp-white.svg")),
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
    return `Reserva confirmada! ${payload.patientName}, seu agendamento de ${payload.procedureName} em ${dateLabel} às ${payload.time} na ${unitLabel} foi confirmado.`;
}

async function tryLoadSmtpConnect(): Promise<SmtpConnect | null> {
    if (!smtpConnectLoader) {
        smtpConnectLoader = import(/* webpackIgnore: true */ "cloudflare:sockets")
            .then((mod) => (typeof mod.connect === "function" ? mod.connect : null))
            .catch(() => null);
    }
    return smtpConnectLoader;
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

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = SMTP_STEP_TIMEOUT_MS): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
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
    await withTimeout(writer.write(new TextEncoder().encode(`${command}\r\n`)), "smtp_write");
    const response = await withTimeout(readSmtpResponse(reader, decoder, state), "smtp_read");
    if (!expectedCodes.includes(response.code)) {
        throw new Error(`smtp_command_failed:${command}:${response.code}`);
    }
}

async function readNodeSmtpResponse(socket: TLSSocket, state: { buffer: string }) {
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

        const chunk = await withTimeout(
            new Promise<string>((resolve, reject) => {
                const onData = (data: Buffer | string) => {
                    cleanup();
                    resolve(typeof data === "string" ? data : data.toString("utf8"));
                };
                const onError = (error: Error) => {
                    cleanup();
                    reject(error);
                };
                const onClose = () => {
                    cleanup();
                    reject(new Error("smtp_connection_closed"));
                };
                const cleanup = () => {
                    socket.off("data", onData);
                    socket.off("error", onError);
                    socket.off("close", onClose);
                    socket.off("end", onClose);
                };

                socket.once("data", onData);
                socket.once("error", onError);
                socket.once("close", onClose);
                socket.once("end", onClose);
            }),
            "smtp_read",
        );
        state.buffer += chunk;
    }
}

async function writeNodeSmtp(socket: TLSSocket, chunk: string) {
    await withTimeout(
        new Promise<void>((resolve, reject) => {
            socket.write(chunk, (error) => {
                if (error) reject(error);
                else resolve();
            });
        }),
        "smtp_write",
    );
}

async function sendNodeSmtpCommand(socket: TLSSocket, state: { buffer: string }, command: string, expectedCodes: number[]) {
    await writeNodeSmtp(socket, `${command}\r\n`);
    const response = await readNodeSmtpResponse(socket, state);
    if (!expectedCodes.includes(response.code)) {
        throw new Error(`smtp_command_failed:${command}:${response.code}`);
    }
}

async function sendTitanEmailViaNodeTls(params: {
    hostname: string;
    port: number;
    user: string;
    pass: string;
    to: string;
    from: string;
    subject: string;
    text: string;
    html: string;
}) {
    const socket = await withTimeout(
        new Promise<TLSSocket>((resolve, reject) => {
            const candidate = tlsConnect(
                {
                    host: params.hostname,
                    port: params.port,
                    servername: params.hostname,
                    rejectUnauthorized: true,
                },
                () => resolve(candidate),
            );
            candidate.setEncoding("utf8");
            candidate.once("error", reject);
        }),
        "smtp_connect",
    );
    const state = { buffer: "" };

    try {
        const greeting = await readNodeSmtpResponse(socket, state);
        if (greeting.code !== 220) {
            throw new Error(`smtp_greeting_failed:${greeting.code}`);
        }

        await sendNodeSmtpCommand(socket, state, "EHLO espacofacial.com", [250]);
        await sendNodeSmtpCommand(socket, state, "AUTH LOGIN", [334]);
        await sendNodeSmtpCommand(socket, state, btoa(params.user), [334]);
        await sendNodeSmtpCommand(socket, state, btoa(params.pass), [235]);
        await sendNodeSmtpCommand(socket, state, `MAIL FROM:<${params.from}>`, [250]);
        await sendNodeSmtpCommand(socket, state, `RCPT TO:<${params.to}>`, [250, 251]);
        await sendNodeSmtpCommand(socket, state, "DATA", [354]);

        const message = buildSmtpMessage({
            from: params.from,
            to: params.to,
            subject: params.subject,
            text: params.text,
            html: params.html,
        });
        await writeNodeSmtp(socket, `${message}\r\n.\r\n`);

        const dataResponse = await readNodeSmtpResponse(socket, state);
        if (dataResponse.code !== 250) {
            throw new Error(`smtp_data_failed:${dataResponse.code}`);
        }

        await sendNodeSmtpCommand(socket, state, "QUIT", [221]);
        return { ok: true, status: "sent", provider: "titan_smtp" } as NotificationResult;
    } finally {
        socket.end();
        socket.destroy();
    }
}

async function sendTitanEmailAttempt(params: {
    connect: SmtpConnect;
    hostname: string;
    port: number;
    transport: "on" | "off" | "starttls";
    useStartTls?: boolean;
    user: string;
    pass: string;
    to: string;
    from: string;
    subject: string;
    text: string;
    html: string;
}) {
    let socket = params.connect({
        hostname: params.hostname,
        port: params.port,
        secureTransport: params.transport,
    });

    let writer = socket.writable.getWriter();
    let reader = socket.readable.getReader();
    let decoder = new TextDecoder();
    let state = { buffer: "" };

    try {
        const greeting = await withTimeout(readSmtpResponse(reader, decoder, state), "smtp_greeting");
        if (greeting.code !== 220) {
            throw new Error(`smtp_greeting_failed:${greeting.code}`);
        }

        await sendSmtpCommand(writer, reader, decoder, state, "EHLO espacofacial.com", [250]);

        if (params.useStartTls) {
            await sendSmtpCommand(writer, reader, decoder, state, "STARTTLS", [220]);
            if (typeof socket.startTls !== "function") {
                throw new Error("smtp_starttls_unavailable");
            }

            const upgraded = (await withTimeout(Promise.resolve(socket.startTls()), "smtp_starttls")) as SmtpSocket;
            writer.releaseLock();
            reader.releaseLock();
            socket = upgraded;
            writer = socket.writable.getWriter();
            reader = socket.readable.getReader();
            decoder = new TextDecoder();
            state = { buffer: "" };
            await sendSmtpCommand(writer, reader, decoder, state, "EHLO espacofacial.com", [250]);
        }

        await sendSmtpCommand(writer, reader, decoder, state, "AUTH LOGIN", [334]);
        await sendSmtpCommand(writer, reader, decoder, state, btoa(params.user), [334]);
        await sendSmtpCommand(writer, reader, decoder, state, btoa(params.pass), [235]);
        await sendSmtpCommand(writer, reader, decoder, state, `MAIL FROM:<${params.from}>`, [250]);
        await sendSmtpCommand(writer, reader, decoder, state, `RCPT TO:<${params.to}>`, [250, 251]);
        await sendSmtpCommand(writer, reader, decoder, state, "DATA", [354]);

        const message = buildSmtpMessage({
            from: params.from,
            to: params.to,
            subject: params.subject,
            text: params.text,
            html: params.html,
        });
        await withTimeout(writer.write(new TextEncoder().encode(`${message}\r\n.\r\n`)), "smtp_data_write");

        const dataResponse = await withTimeout(readSmtpResponse(reader, decoder, state), "smtp_data_read");
        if (dataResponse.code !== 250) {
            throw new Error(`smtp_data_failed:${dataResponse.code}`);
        }

        await sendSmtpCommand(writer, reader, decoder, state, "QUIT", [221]);
        return { ok: true, status: "sent", provider: "titan_smtp" } as NotificationResult;
    } finally {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
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
    if (!to) {
        return { ok: false, status: "failed", error: "invalid_email_fields" };
    }

    let user = "";
    let pass = "";
    const normalizedUnitSlug = (params.unitSlug ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedUnitSlug === "barrashoppingsul") {
        user = sanitizeEmail(await getRuntimeSecret("TITAN_SMTP_USER_BARRA"));
        pass = await getRuntimeSecret("TITAN_SMTP_PASS_BARRA");
    } else if (normalizedUnitSlug === "novohamburgo") {
        user = sanitizeEmail(await getRuntimeSecret("TITAN_SMTP_USER_NH"));
        pass = await getRuntimeSecret("TITAN_SMTP_PASS_NH");
    }

    if (!user || !pass) {
        return { ok: false, status: "skipped", error: "smtp_not_configured_for_unit" };
    }

    // For unit-bound Titan accounts, force the visible sender to match the
    // authenticated mailbox so the reservation email always leaves from the
    // selected clinic unit.
    const from = sanitizeEmail(user) || sanitizeEmail(params.from);
    if (!from) {
        return { ok: false, status: "failed", error: "invalid_email_fields" };
    }

    const host = (await getRuntimeSecret("TITAN_SMTP_HOST")) || "smtp.titan.email";
    const portRaw = Number((await getRuntimeSecret("TITAN_SMTP_PORT")) || 465);
    const port = Number.isFinite(portRaw) ? portRaw : 465;

    if (port === 465) {
        const tlsResult = await sendTitanEmailViaNodeTls({
            hostname: host,
            port,
            user,
            pass,
            to,
            from,
            subject: params.subject,
            text: params.text,
            html: params.html,
        }).catch((error) => ({
            ok: false,
            status: "failed",
            provider: "titan_smtp",
            error: error instanceof Error ? error.message : "smtp_send_failed",
        } as NotificationResult));
        if (tlsResult.ok) {
            return tlsResult;
        }
    }

    const attempts: Array<{ port: number; transport: "on" | "off" | "starttls"; useStartTls?: boolean }> = [];
    const pushAttempt = (attempt: { port: number; transport: "on" | "off" | "starttls"; useStartTls?: boolean }) => {
        if (!attempts.some((item) => item.port === attempt.port && item.transport === attempt.transport && !!item.useStartTls === !!attempt.useStartTls)) {
            attempts.push(attempt);
        }
    };
    pushAttempt({ port, transport: port === 587 ? "starttls" : "on", useStartTls: port === 587 });
    pushAttempt({ port: 587, transport: "starttls", useStartTls: true });
    pushAttempt({ port: 465, transport: "on" });

    try {
        let lastError = "smtp_send_failed";

        for (const attempt of attempts) {
            const result = await sendTitanEmailAttempt({
                connect,
                hostname: host,
                port: attempt.port,
                transport: attempt.transport,
                useStartTls: attempt.useStartTls,
                user,
                pass,
                to,
                from,
                subject: params.subject,
                text: params.text,
                html: params.html,
            }).catch((error) => {
                lastError = error instanceof Error ? error.message : "smtp_send_failed";
                return null;
            });

            if (result?.ok) {
                return result;
            }
        }

        return {
            ok: false,
            status: "failed",
            provider: "titan_smtp",
            error: lastError,
        };
    } catch (error) {
        return {
            ok: false,
            status: "failed",
            provider: "titan_smtp",
            error: error instanceof Error ? error.message : "smtp_send_failed",
        };
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
    const from = unitFrom || envFrom;

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

    if (smtpResult.status === "failed") {
        return {
            ok: false,
            status: "failed",
            provider: smtpResult.provider,
            error: smtpResult.error ?? "send_failed",
        };
    }

    return {
        ok: false,
        status: "skipped",
        error: smtpResult.error ?? "not_configured",
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
