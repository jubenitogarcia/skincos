import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import MetaMountEvent from "@/components/MetaMountEvent";
import TrackedBookingLink from "@/components/TrackedBookingLink";
import { getDigitalJourneyUnits } from "@/data/units";
import { getCanonicalDigitalUnitSlug, getUnitHref, isDigitalJourneyUnit, resolveUnitFromSlug } from "@/lib/unitRoutes";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const unit = resolveUnitFromSlug(slug);

  if (!unit) {
    return {
      title: "Unidades",
      robots: { index: false, follow: false },
      alternates: { canonical: `${siteUrl}/unidades` },
    };
  }

  if (isDigitalJourneyUnit(unit)) {
    const canonicalUrl = `${siteUrl}/${getCanonicalDigitalUnitSlug(unit)}`;
    return {
      title: unit.name,
      description: `Conheça a unidade ${unit.name}, veja localização, equipe e agendamento com mais facilidade.`,
      robots: { index: false, follow: true },
      alternates: { canonical: canonicalUrl },
      openGraph: {
        title: unit.name,
        description: `Conheça a unidade ${unit.name}, veja localização, equipe e agendamento com mais facilidade.`,
        url: canonicalUrl,
        type: "website",
      },
    };
  }

  const canonicalUrl = `${siteUrl}/unidades/${unit.slug}`;
  return {
    title: `${unit.name} | Rede Espaço Facial`,
    description: `Conheça a unidade ${unit.name} na rede Espaço Facial e encontre rota, contato e acesso ao agendamento.`,
    robots: { index: false, follow: true },
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${unit.name} | Rede Espaço Facial`,
      description: `Conheça a unidade ${unit.name} na rede Espaço Facial e encontre rota, contato e acesso ao agendamento.`,
      url: canonicalUrl,
      type: "website",
    },
  };
}

export default async function UnitPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const unit = resolveUnitFromSlug(slug);

  if (!unit) {
    redirect("/unidades");
  }

  if (isDigitalJourneyUnit(unit)) {
    redirect(getUnitHref(unit));
  }

  if (slug !== unit.slug) {
    redirect(`/unidades/${unit.slug}`);
  }

  const featuredUnits = getDigitalJourneyUnits();
  const hasAddress = Boolean(unit.addressLine?.trim());

  return (
    <>
      <Header />
      <MetaMountEvent
        eventName="ViewContent"
        dedupeKey={`unit-directory:${unit.slug}`}
        params={{
          content_type: "unit",
          content_name: unit.name,
          content_ids: [unit.slug],
        }}
      />
      <main className="container">
        <section className="pageSection pageNarrative">
          <div className="pageNarrative__intro">
            <span className="pageNarrative__eyebrow">Unidade da rede</span>
            <h1 className="sectionTitle">{unit.name}</h1>
            <p className="sectionSub pageNarrative__sub">
              Esta unidade faz parte da rede Espaço Facial. Você pode abrir a rota, conhecer outras unidades da rede ou seguir para o agendamento online.
            </p>
          </div>

          <div className="pageNarrative__stats" role="group" aria-label="Resumo da unidade">
            <div className="pageNarrative__stat">
              <strong>{unit.state ?? "Brasil"}</strong>
              <span>estado onde esta unidade está localizada</span>
            </div>
            <div className="pageNarrative__stat">
              <strong>{hasAddress ? "Endereço" : "Endereço em atualização"}</strong>
              <span>{hasAddress ? unit.addressLine : "O endereço completo desta unidade será publicado em breve."}</span>
            </div>
            <div className="pageNarrative__stat">
              <strong>Atendimento</strong>
              <span>Você pode seguir para o agendamento ou conhecer outras unidades da rede.</span>
            </div>
          </div>
        </section>

        <section className="pageSection decisionCardsSection" aria-label="Informações da unidade">
          <div className="decisionCards">
            <article className="decisionCard">
              <div className="decisionCard__eyebrow">Agendamento</div>
              <h2>Se quiser reservar agora, siga para o agendamento online.</h2>
              <p>
                Se você quer marcar o atendimento logo, siga para o agendamento online e veja os horários disponíveis.
              </p>
              <div className="decisionCard__actions">
                <TrackedBookingLink href="/agendamento?doctor=any#booking-flow" className="decisionCard__primary" placement="units_page">
                  Ir para o agendamento
                </TrackedBookingLink>
              </div>
            </article>

            <article className="decisionCard">
              <div className="decisionCard__eyebrow">Outras unidades</div>
              <h2>Se preferir, veja unidades com mais informações antes de reservar.</h2>
              <p>
                Se preferir ver equipe, contato e mais detalhes antes de reservar, abra uma das unidades em destaque.
              </p>
              <div className="decisionCard__linksRow">
                {featuredUnits.map((featuredUnit) => (
                  <Link key={featuredUnit.slug} href={getUnitHref(featuredUnit)} className="decisionCard__link">
                    {featuredUnit.name}
                  </Link>
                ))}
              </div>
            </article>

            <article className="decisionCard">
              <div className="decisionCard__eyebrow">Como chegar</div>
              <h2>Veja a localização desta unidade e abra a rota no mapa.</h2>
              <p>
                Volte ao mapa da rede para comparar unidades ou abra a rota desta unidade diretamente.
              </p>
              <div className="decisionCard__actions">
                <Link href="/unidades#units-map" className="decisionCard__secondary">
                  Voltar ao mapa
                </Link>
                {unit.maps ? (
                  <a href={unit.maps} className="decisionCard__link" target="_blank" rel="noreferrer">
                    Abrir rota desta unidade
                  </a>
                ) : null}
              </div>
            </article>
          </div>
        </section>
      </main>
      <Footer />
      <FloatingContact />
    </>
  );
}
