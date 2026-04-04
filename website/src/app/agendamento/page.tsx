import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import BookingFlow from "@/components/BookingFlow";
import BookingHeroExperience from "@/components/BookingHeroExperience";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");

export const metadata = {
    title: "Agendamento",
    description:
        "Reserve sua avaliação online na Espaço Facial escolhendo unidade, especialista e horário com praticidade.",
    robots: {
        index: true,
        follow: true,
    },
    alternates: {
        canonical: `${siteUrl}/agendamento`,
    },
    openGraph: {
        title: "Agendamento",
        description:
            "Reserve sua avaliação online na Espaço Facial escolhendo unidade, especialista e horário com praticidade.",
        url: `${siteUrl}/agendamento`,
        type: "website",
    },
};

export default function AgendamentoPage() {
    return (
        <>
            <Header />
            <main className="bookingPage">
                <BookingHeroExperience />
                <section id="booking-flow" className="bookingFlowSection">
                    <BookingFlow />
                </section>
            </main>
            <Footer />
            <FloatingContact />
        </>
    );
}
