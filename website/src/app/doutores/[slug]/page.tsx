import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import DoctorPublicProfileCard from "@/components/DoctorPublicProfileCard";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import MetaMountEvent from "@/components/MetaMountEvent";
import TrackedBookingLink from "@/components/TrackedBookingLink";
import { doctorSlugMatchesQuery, canonicalDoctorSlugForMember, findMarketingDoctorByQuery } from "@/lib/doctorSlug";
import { fetchActiveInjectorsResult } from "@/lib/injectorsDirectory";

type DirectoryDoctor = {
  name: string;
  nickname: string | null;
  units: string[];
  role: string;
  roles: string[];
  instagramHandle: string | null;
  instagramUrl: string | null;
};

type ResolvedDoctor = {
  slug: string;
  name: string;
  days?: string;
  bookingUrl?: string;
};

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");

async function findDirectoryDoctor(slug: string): Promise<DirectoryDoctor | null> {
  try {
    const result = await fetchActiveInjectorsResult();
    if (!result.ok) return null;
    return result.members.find((member) => doctorSlugMatchesQuery(slug, member)) ?? null;
  } catch {
    return null;
  }
}

async function resolveDoctorProfile(slug: string): Promise<{ doc: ResolvedDoctor; directoryDoctor: DirectoryDoctor | null } | null> {
  const marketingDoctor = findMarketingDoctorByQuery(slug);
  const directoryDoctor = await findDirectoryDoctor(marketingDoctor?.slug ?? slug);
  if (!marketingDoctor && !directoryDoctor) return null;

  const doc: ResolvedDoctor = marketingDoctor
    ? marketingDoctor
    : {
        slug: canonicalDoctorSlugForMember({
          name: directoryDoctor!.name,
          instagramHandle: directoryDoctor!.instagramHandle,
        }),
        name: directoryDoctor!.name,
      };

  return { doc, directoryDoctor };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolveDoctorProfile(slug);
  if (!resolved) return {};
  const { doc, directoryDoctor } = resolved;

  const title = doc.name;
  const description = [
    directoryDoctor?.roles.find(Boolean) ?? directoryDoctor?.role ?? null,
    directoryDoctor?.units.length ? directoryDoctor.units.join(", ") : null,
    doc.days,
    "Agende na unidade selecionada.",
  ]
    .filter(Boolean)
    .join(" ");

  const canonical = `${siteUrl}/doutores/${doc.slug}`;

  return {
    title,
    description,
    robots: {
      index: false,
      follow: false,
      nocache: true,
    },
    alternates: { canonical },
    openGraph: {
      title: `${doc.name} | Espaço Facial`,
      description,
      url: canonical,
      type: "profile",
    },
  };
}

export default async function DoctorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resolved = await resolveDoctorProfile(slug);
  if (!resolved) return notFound();
  const { doc, directoryDoctor } = resolved;
  const canonicalSlug = directoryDoctor
    ? canonicalDoctorSlugForMember({ name: directoryDoctor.name, instagramHandle: directoryDoctor.instagramHandle })
    : doc.slug;
  if (slug !== canonicalSlug) {
    permanentRedirect(`/doutores/${canonicalSlug}`);
  }
  const bookingHref = `/agendamento?doctor=${encodeURIComponent(doc.slug)}`;
  const availabilityLabel = doc.days ?? "Agenda conforme disponibilidade da unidade";
  const roleLabel = directoryDoctor?.roles.find(Boolean) ?? directoryDoctor?.role ?? "Especialista da rede";
  const unitLabels = directoryDoctor?.units ?? [];
  const publicProofAvailable = Boolean(directoryDoctor?.instagramHandle || directoryDoctor?.instagramUrl);

  return (
    <>
      <Header />
      <main className="container" style={{ paddingTop: 26 }}>
        <MetaMountEvent
          eventName="ViewContent"
          dedupeKey={`doctor:${doc.slug}`}
          params={{
            content_type: "doctor",
            content_name: doc.name,
            content_ids: [doc.slug],
          }}
        />
        <section className="pageSection" style={{ marginTop: 0 }}>
          <div className="pageNarrative">
            <div className="pageNarrative__intro">
              <span className="pageNarrative__eyebrow">Especialista</span>
              <h1 className="sectionTitle">{doc.name}</h1>
              <p className="sectionSub pageNarrative__sub">
                Conheça este especialista, veja onde atende e reserve seu horário com mais segurança.
              </p>
            </div>

            <div className="pageNarrative__stats" role="group" aria-label="Resumo do especialista">
              <div className="pageNarrative__stat">
                <strong>{availabilityLabel}</strong>
                <span>dias informados para atendimento</span>
              </div>
              <div className="pageNarrative__stat">
                <strong>{roleLabel}</strong>
                <span>atuação deste especialista</span>
              </div>
              <div className="pageNarrative__stat">
                <strong>{unitLabels.length ? unitLabels.join(" • ") : "Unidades da rede"}</strong>
                <span>
                  {unitLabels.length
                    ? "unidades em que este especialista atende"
                    : "a unidade pode ser escolhida durante o agendamento"}
                </span>
              </div>
            </div>
          </div>

          <div className="decisionCardsSection">
            <div className="decisionCards">
              <article className="decisionCard">
                <div className="decisionCard__eyebrow">Sobre este especialista</div>
                <h2>Veja este especialista com mais calma antes de reservar.</h2>
                <p>
                  Confira atuação, unidades de atendimento e Instagram quando disponível.
                </p>
                <DoctorPublicProfileCard
                  name={doc.name}
                  handle={directoryDoctor?.instagramHandle ?? null}
                  instagramUrl={directoryDoctor?.instagramUrl ?? null}
                  roleLabel={roleLabel}
                  availabilityLabel={availabilityLabel}
                  unitLabels={unitLabels}
                />
              </article>

              <article className="decisionCard">
                <div className="decisionCard__eyebrow">Atendimento</div>
                <h2>Se este especialista combina com o que você procura, siga para o agendamento.</h2>
                <p>
                  Ao abrir a agenda, este especialista já aparece selecionado. Se preferir, você ainda pode comparar outros nomes ou escolher primeiro a unidade.
                </p>
                <div className="decisionCard__meta">
                  <span className="decisionCard__metaItem">Especialista já selecionado na agenda</span>
                  <span className="decisionCard__metaItem">Você ainda pode ajustar unidade e procedimento</span>
                  <span className="decisionCard__metaItem">
                    {publicProofAvailable ? "Instagram disponível para consulta" : "Agendamento disponível normalmente"}
                  </span>
                </div>
              </article>

              <article className="decisionCard">
                <div className="decisionCard__eyebrow">Agendamento</div>
                <h2>Se quiser reservar com este especialista, siga para a agenda.</h2>
                <p>
                  Se quiser reservar com este especialista, use o atalho abaixo. Se preferir, compare outros perfis ou veja as unidades primeiro.
                </p>
                <div className="decisionCard__actions">
                  <TrackedBookingLink className="decisionCard__primary" href={bookingHref} placement="doctor" doctorName={doc.name}>
                    Agendar com este especialista
                  </TrackedBookingLink>
                  <Link className="decisionCard__secondary" href="/doutores">
                    Ver outros especialistas
                  </Link>
                  <Link className="decisionCard__link" href="/unidades#units-featured">
                    Ver unidades
                  </Link>
                </div>
              </article>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <FloatingContact />
    </>
  );
}
