import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import { doctors } from "@/data/doctors";
import DoctorAgendarPill from "@/components/DoctorAgendarPill";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = doctors.find((d) => d.slug === slug);
  if (!doc) return {};

  const title = doc.name;
  const description = doc.days
    ? `${doc.days}. Agende na unidade selecionada.`
    : "Agende na unidade selecionada.";

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
  const doc = doctors.find((d) => d.slug === slug);
  if (!doc) return notFound();

  return (
    <>
      <Header />
      <main className="container" style={{ paddingTop: 26 }}>
        <h1 style={{ marginBottom: 6 }}>{doc.name}</h1>
        <p style={{ color: "#6b6b6b", marginTop: 0 }}>{doc.days}</p>
        <div className="pillRow">
          <DoctorAgendarPill doctorName={doc.name} />
        </div>

        <div style={{ marginTop: 26 }} className="card">
          <h3>Bio / Procedimentos</h3>
          <p>
            Coloque aqui a biografia, especialidades, fotos e agenda. Este arquivo já está pronto para isso.
          </p>
        </div>
      </main>
      <Footer />
      <FloatingContact />
    </>
  );
}
