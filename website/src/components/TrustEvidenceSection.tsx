import TrackedBookingLink from "@/components/TrackedBookingLink";
import TrackedExperienceLink from "@/components/TrackedExperienceLink";
import TrustEvidenceUnitBadge from "@/components/TrustEvidenceUnitBadge";
import { getTrustEvidenceSummary, TRUST_EVIDENCE_CAPTURED_AT, TRUST_EVIDENCE_UNITS } from "@/data/trustEvidence";
import { getTrustEvidenceDbSummary } from "@/lib/gbpReviewsDb";
import { fetchActiveInjectorsResult } from "@/lib/injectorsDirectory";
import { getUnitHref } from "@/lib/unitRoutes";

type TrustEvidenceSectionProps = {
  context: "home" | "booking";
};

type TeamSignals = {
  members: number;
  instagramProfiles: number;
  roles: number;
  unitsRepresented: number;
} | null;

const COPY = {
    home: {
      eyebrow: "Harmonização facial com naturalidade",
      title: "Realce sua beleza com equilíbrio, segurança e resultado natural.",
      description:
        "Na Espaço Facial, cada atendimento começa com uma avaliação cuidadosa para indicar o que faz sentido para o seu rosto e/ou corpo, sua rotina e suas expectativas, com segurança, elegância e naturalidade.",
      primaryCta: "Agendar avaliação",
      secondaryCta: "Ver especialistas",
      actionHint: "Leva menos de 1 minuto para começar o seu agendamento.",
      decisionBody:
        "Você pode confirmar a reputação da unidade, comparar especialistas e seguir para o agendamento com mais tranquilidade.",
      tertiaryCta: "Ver unidades",
    },
    booking: {
        eyebrow: "Mais segurança antes de reservar",
        title: "Antes de confirmar, veja sinais reais de confiança e atendimento.",
        description:
      "Veja avaliações das unidades e conheça a equipe antes de confirmar seu pedido.",
    primaryCta: "Seguir para os horários",
    secondaryCta: "Consultar unidades",
    tertiaryTitle: "Confirme sua escolha com tranquilidade",
    tertiaryBody:
      "Se quiser, confirme melhor a unidade ou o especialista antes de finalizar. Se já estiver decidido, siga para os horários.",
  },
} as const;

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatDateFromMs(value: number) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

async function getTeamSignals(): Promise<TeamSignals> {
  try {
    const result = await fetchActiveInjectorsResult();
    if (!result.ok) return null;

    const members = result.members;
    return {
      members: members.length,
      instagramProfiles: members.filter((member) => member.instagramUrl).length,
      roles: new Set(
        members.flatMap((member) => member.roles.map((role) => role.trim()).filter(Boolean)),
      ).size,
      unitsRepresented: new Set(
        members.flatMap((member) => member.units.map((unit) => unit.trim()).filter(Boolean)),
      ).size,
    };
  } catch {
    return null;
  }
}

export default async function TrustEvidenceSection({ context }: TrustEvidenceSectionProps) {
  const copy = COPY[context];
  const bookingCopy = COPY.booking;
  const fallbackSummary = getTrustEvidenceSummary();
  const liveSummary = await getTrustEvidenceDbSummary(TRUST_EVIDENCE_UNITS.map((unit) => unit.slug));
  const summary = liveSummary
    ? {
        totalReviews: liveSummary.totalReviews,
        totalPhotos: fallbackSummary.totalPhotos,
        weightedRating: liveSummary.weightedRating,
      }
    : fallbackSummary;
  const teamSignals = await getTeamSignals();
  const snapshotDate = liveSummary?.capturedAtMs ? formatDateFromMs(liveSummary.capturedAtMs) : formatDate(TRUST_EVIDENCE_CAPTURED_AT);
  const page = context === "home" ? "/" : "/agendamento";
  const placement = context === "home" ? "home_panel" : "booking_page";
  const experience = "trust_evidence_v1";
  const variant = context;

  const homeQualityBadges = [
    {
      title: "Avaliação cuidadosa",
      body: "Tratamento indicado para você.",
    },
    {
      title: "Especialistas qualificados",
      body: "Escolha com mais confiança.",
    },
    {
      title: "Atendimento contínuo",
      body: "Cuidado do início ao retorno.",
    },
    {
      title: "Beleza sem exageros",
      body: "Resultados leves e naturais.",
    },
  ] as const;

  if (context === "home") {
    return (
      <section className="trustEvidenceBand" aria-label="Sinais de qualidade da Espaço Facial">
        <div className="container trustEvidenceBand__inner">
          <div className="trustEvidenceBand__grid" role="list">
            <TrustEvidenceUnitBadge
              fallbackRating={summary.weightedRating}
              fallbackTotalReviews={summary.totalReviews}
            />
            {homeQualityBadges.map((item) => (
              <article key={item.title} className="trustEvidenceBand__card" role="listitem">
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`pageSection pageNarrative trustEvidence trustEvidence--${context}`.trim()}
      aria-label="Avaliações e confiança"
    >
      <div className="pageNarrative__intro">
        <span className="pageNarrative__eyebrow">{copy.eyebrow}</span>
        <h2 className="sectionTitle">{copy.title}</h2>
        <p className="sectionSub pageNarrative__sub">{copy.description}</p>
      </div>

      <div className="pageNarrative__stats" role="group" aria-label="Panorama de confiança">
        <div className="pageNarrative__stat">
          <strong>{summary.weightedRating.toFixed(1)}★</strong>
          <span>média pública das unidades em destaque.</span>
        </div>
        <div className="pageNarrative__stat">
          <strong>{summary.totalReviews}</strong>
          <span>avaliações públicas consultadas em {snapshotDate}.</span>
        </div>
        <div className="pageNarrative__stat">
          <strong>{teamSignals?.members ?? "Equipe disponível"}</strong>
          <span>
            {teamSignals
              ? `${teamSignals.instagramProfiles} perfis públicos e ${teamSignals.roles} áreas de atuação na equipe.`
              : "A equipe segue disponível na página de especialistas e no agendamento."}
          </span>
        </div>
      </div>

      <div className="decisionCards trustEvidence__cards">
        <article className="decisionCard">
          <div className="decisionCard__eyebrow">Equipe</div>
          <h2>Escolher fica mais fácil quando você consegue conhecer quem atende.</h2>
          <p>
            Conheça os especialistas, veja onde atendem e escolha com mais segurança antes de reservar.
          </p>
          <div className="decisionCard__meta">
            <span className="decisionCard__metaItem">
              {teamSignals?.members ?? "Equipe disponível"} profissionais disponíveis
            </span>
            <span className="decisionCard__metaItem">
              {teamSignals?.unitsRepresented ?? TRUST_EVIDENCE_UNITS.length} unidades com equipe consultável
            </span>
            <span className="decisionCard__metaItem">
              {teamSignals?.instagramProfiles ?? "Perfis"} com presença pública acessível
            </span>
          </div>
          <div className="decisionCard__actions">
            <TrackedExperienceLink
              href="/doutores"
              className="decisionCard__secondary"
              page={page}
              shortcut="Comparar especialistas"
              destination="/doutores"
              placement={placement}
              experience={experience}
              variant={variant}
            >
              Comparar especialistas
            </TrackedExperienceLink>
            <TrackedExperienceLink
              href={getUnitHref(TRUST_EVIDENCE_UNITS[0]?.slug ?? "barrashoppingsul")}
              className="decisionCard__link"
              page={page}
              shortcut="Ver unidade com avaliações"
              destination={getUnitHref(TRUST_EVIDENCE_UNITS[0]?.slug ?? "barrashoppingsul")}
              placement={placement}
              unitSlug={TRUST_EVIDENCE_UNITS[0]?.slug ?? "barrashoppingsul"}
              experience={experience}
              variant={variant}
            >
              Ver unidade com avaliações
            </TrackedExperienceLink>
          </div>
        </article>

        <article className="decisionCard">
          <div className="decisionCard__eyebrow">Reserve com tranquilidade</div>
          <h2>{bookingCopy.tertiaryTitle}</h2>
          <p>{bookingCopy.tertiaryBody}</p>
          <ul className="trustEvidence__list">
            <li>Veja as avaliações completas da unidade para confirmar sua escolha.</li>
            <li>Entre sem preferência de especialista se quiser mais opções de horário.</li>
            <li>Compare especialistas antes de agendar se quiser decidir com mais calma.</li>
          </ul>
          <div className="decisionCard__actions">
            <TrackedBookingLink
              href="/agendamento#booking-flow"
              className="decisionCard__primary"
              placement={placement}
              experience={experience}
              variant={variant}
            >
              {copy.primaryCta}
            </TrackedBookingLink>
            <TrackedExperienceLink
              href="/unidades#units-featured"
              className="decisionCard__secondary"
              page={page}
              shortcut={copy.secondaryCta}
              destination="/unidades#units-featured"
              placement={placement}
              experience={experience}
              variant={variant}
            >
              {copy.secondaryCta}
            </TrackedExperienceLink>
          </div>
        </article>
      </div>
    </section>
  );
}
