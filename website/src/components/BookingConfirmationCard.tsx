/* eslint-disable @next/next/no-img-element */
"use client";

import { buildBookingConfirmationViewModel, resolveBookingSiteUrl, type BookingConfirmationPayload } from "@/lib/bookingConfirmationView";

type NotificationResult = {
    ok: boolean;
    status: string;
    provider?: string;
    error?: string;
};

type BookingConfirmationCardProps = {
    reservation: BookingConfirmationPayload;
    notifications?: {
        email?: NotificationResult;
        whatsapp?: NotificationResult;
    };
    variant?: "default" | "details_link";
};

function notificationLabel(result?: NotificationResult): string {
    if (!result) return "Não informado";
    if (result.status === "sent") return "Enviado";
    if (result.status === "failed") return "Falhou";
    if (result.error === "not_configured" || result.error === "smtp_not_configured_for_unit") return "Não configurado";
    return "Pendente de configuração";
}

function notificationTone(result?: NotificationResult): "success" | "warning" | "danger" | "neutral" {
    if (!result) return "neutral";
    if (result.status === "sent") return "success";
    if (result.status === "failed") return "danger";
    if (result.error === "not_configured" || result.error === "smtp_not_configured_for_unit") return "warning";
    return "neutral";
}

export default function BookingConfirmationCard(props: BookingConfirmationCardProps) {
    const model = buildBookingConfirmationViewModel(props.reservation, {
        siteUrl: resolveBookingSiteUrl(),
    });
    const hasNotificationStatuses = !!props.notifications?.email || !!props.notifications?.whatsapp;
    const isDetailsLinkVariant = props.variant === "details_link";

    return (
        <section className="bookingConfirmation" aria-label="Resumo da reserva confirmada">
            <div className="bookingConfirmation__hero">
                <div className="bookingConfirmation__heroLogoWrap">
                    <img src={model.logoUrl} alt="Espaço Facial" className="bookingConfirmation__logo" />
                </div>
                <div className="bookingConfirmation__check">✓</div>
                <div className="bookingConfirmation__eyebrow">Confirmação de reserva</div>
                <h2 className="bookingConfirmation__title">Sua reserva foi confirmada</h2>
                <p className="bookingConfirmation__subtitle">
                    Recebemos seu agendamento com sucesso. Guarde os dados abaixo e use os canais da unidade se precisar de suporte.
                </p>
            </div>

            <div className="bookingConfirmation__detailsCard">
                <div className="bookingConfirmation__detailsContent">
                    <div>
                        <div className="bookingConfirmation__sectionTitle">Dados da reserva</div>
                        <div className="bookingConfirmation__detailGrid">
                            <div>
                                <div className="bookingConfirmation__detailLabel">Nome</div>
                                <div className="bookingConfirmation__detailValue">{model.customerName}</div>
                            </div>
                            <div>
                                <div className="bookingConfirmation__detailLabel">Procedimento</div>
                                <div className="bookingConfirmation__detailValue">{model.procedureName}</div>
                            </div>
                            <div>
                                <div className="bookingConfirmation__detailLabel">Data</div>
                                <div className="bookingConfirmation__detailValue">{model.appointmentDate}</div>
                            </div>
                            <div>
                                <div className="bookingConfirmation__detailLabel">Horário</div>
                                <div className="bookingConfirmation__detailValue">{model.appointmentTime}</div>
                            </div>
                            <div>
                                <div className="bookingConfirmation__detailLabel">Unidade</div>
                                <div className="bookingConfirmation__detailValue">{model.unitName}</div>
                            </div>
                            {model.doctorName ? (
                                <div>
                                    <div className="bookingConfirmation__detailLabel">Profissional</div>
                                    <div className="bookingConfirmation__detailValue">{model.doctorName}</div>
                                </div>
                            ) : null}
                            <div>
                                <div className="bookingConfirmation__detailLabel">WhatsApp</div>
                                <div className="bookingConfirmation__detailValue">{model.customerWhatsapp}</div>
                            </div>
                            <div>
                                <div className="bookingConfirmation__detailLabel">E-mail</div>
                                <div className="bookingConfirmation__detailValue">{model.customerEmail}</div>
                            </div>
                        </div>

                        {isDetailsLinkVariant ? (
                            <div className="bookingConfirmation__detailSupplement">
                                <div className="bookingConfirmation__detailLabel">Próximos passos</div>
                                <div className="bookingConfirmation__nextSteps bookingConfirmation__nextSteps--embedded">
                                    {model.nextSteps.map((step) => (
                                        <div key={step} className="bookingConfirmation__nextStep">
                                            {step}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div className="bookingConfirmation__ambassadorWrap">
                        <img src={model.ambassadorImageUrl} alt={model.ambassadorName} className="bookingConfirmation__ambassador" />
                    </div>
                </div>
            </div>

            {hasNotificationStatuses ? (
                <div className="bookingConfirmation__supportCard">
                    <div>
                        <div className="bookingConfirmation__sectionTitle">Canais da confirmação</div>
                        <p className="bookingConfirmation__body">
                            O site tenta enviar a confirmação automaticamente pelos canais abaixo. Quando algum deles não estiver configurado, a reserva continua válida.
                        </p>
                    </div>

                    <div className="bookingConfirmation__statusGrid">
                        <div className="bookingConfirmation__statusItem">
                            <span className="bookingConfirmation__statusLabel">E-mail</span>
                            <span className="bookingConfirmation__statusValue" data-tone={notificationTone(props.notifications?.email)}>
                                {notificationLabel(props.notifications?.email)}
                            </span>
                        </div>
                        <div className="bookingConfirmation__statusItem">
                            <span className="bookingConfirmation__statusLabel">WhatsApp</span>
                            <span className="bookingConfirmation__statusValue" data-tone={notificationTone(props.notifications?.whatsapp)}>
                                {notificationLabel(props.notifications?.whatsapp)}
                            </span>
                        </div>
                    </div>
                </div>
            ) : null}

            {!isDetailsLinkVariant ? (
                <>
                    <div className="bookingConfirmation__supportCard">
                        <div>
                            <div className="bookingConfirmation__sectionTitle">Próximos passos</div>
                            <div className="bookingConfirmation__nextSteps">
                                {model.nextSteps.map((step) => (
                                    <div key={step} className="bookingConfirmation__nextStep">
                                        {step}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bookingConfirmation__actions">
                            <a href={model.teamContactUrl} className="bookingConfirmation__cta bookingConfirmation__cta--secondary">
                                Falar com a equipe
                            </a>
                            <a href={model.unitWhatsappUrl} className="bookingConfirmation__cta">
                                Abrir WhatsApp da unidade
                            </a>
                        </div>
                    </div>

                    <div className="bookingConfirmation__footer">
                        <div className="bookingConfirmation__footerCol">
                            <div className="bookingConfirmation__detailLabel">Instagram</div>
                            <a href={model.unitInstagramUrl} className="bookingConfirmation__footerLink">
                                {model.unitInstagramLabel}
                            </a>
                        </div>
                        <div className="bookingConfirmation__footerCol">
                            <div className="bookingConfirmation__detailLabel">Facebook</div>
                            <a href={model.unitFacebookUrl} className="bookingConfirmation__footerLink">
                                {model.unitFacebookLabel}
                            </a>
                        </div>
                        <div className="bookingConfirmation__footerCol">
                            <div className="bookingConfirmation__detailLabel">WhatsApp</div>
                            <a href={model.unitWhatsappUrl} className="bookingConfirmation__footerLink">
                                {model.unitWhatsappLabel}
                            </a>
                        </div>
                        <div className="bookingConfirmation__footerAddress">
                            <div className="bookingConfirmation__detailLabel">Endereço da unidade</div>
                            <div className="bookingConfirmation__footerText">{model.unitAddress}</div>
                        </div>
                    </div>
                </>
            ) : null}
        </section>
    );
}
