/* eslint-disable @next/next/no-img-element */
"use client";

import { buildBookingConfirmationViewModel, resolveBookingSiteUrl, type BookingConfirmationPayload } from "@/lib/bookingConfirmationView";
import TrackedWhatsappLink from "@/components/TrackedWhatsappLink";

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

export default function BookingConfirmationCard(props: BookingConfirmationCardProps) {
    const model = buildBookingConfirmationViewModel(props.reservation, {
        siteUrl: resolveBookingSiteUrl(),
    });
    const isDetailsLinkVariant = props.variant === "details_link";

    return (
        <section className="bookingConfirmation" aria-label="Resumo da reserva confirmada">
            <div className="bookingConfirmation__hero">
                <div className="bookingConfirmation__heroLogoWrap">
                    <img src={model.logoUrl} alt="Espaço Facial" className="bookingConfirmation__logo" />
                </div>
                <div className="bookingConfirmation__check">✓</div>
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
                            <TrackedWhatsappLink
                                rawUrl={model.unitWhatsappUrl}
                                className="bookingConfirmation__cta"
                                placement="booking_confirmation_primary"
                                unitSlug={props.reservation.unitSlug}
                                doctorName={props.reservation.doctorName}
                                bookingId={props.reservation.id}
                                source="booking_confirmation"
                            >
                                Abrir WhatsApp da unidade
                            </TrackedWhatsappLink>
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
                            <TrackedWhatsappLink
                                rawUrl={model.unitWhatsappUrl}
                                className="bookingConfirmation__footerLink"
                                placement="booking_confirmation_footer"
                                unitSlug={props.reservation.unitSlug}
                                doctorName={props.reservation.doctorName}
                                bookingId={props.reservation.id}
                                source="booking_confirmation"
                            >
                                {model.unitWhatsappLabel}
                            </TrackedWhatsappLink>
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
