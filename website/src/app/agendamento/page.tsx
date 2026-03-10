import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import BookingFlow from "@/components/BookingFlow";

export const metadata = {
    title: "Agendamento de Procedimentos",
    description:
        "Agende online seu atendimento na Espaço Facial escolhendo unidade, profissional, procedimento e horário.",
    robots: {
        index: true,
        follow: true,
    },
    alternates: {
        canonical: "/agendamento",
    },
};

export default function AgendamentoPage() {
    return (
        <>
            <Header />
            <main className="bookingPage">
                <section id="booking-flow" className="bookingFlowSection">
                    <BookingFlow />
                </section>
            </main>
            <Footer />
            <FloatingContact />
        </>
    );
}
