import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CadastroWheelExperience from "@/components/CadastroWheelExperience";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");
const cadastroWhatsappPhone =
    process.env.NEXT_PUBLIC_CADASTRO_WHATSAPP_PHONE?.replace(/\D/g, "") === "5551998493563"
        ? "5551995811008"
        : (process.env.NEXT_PUBLIC_CADASTRO_WHATSAPP_PHONE ?? "5551995811008");

export const metadata: Metadata = {
    title: "Cadastro",
    description:
        "Gire a Roda da Beleza da Espaço Facial, descubra seu prêmio e siga para o atendimento pelo WhatsApp.",
    alternates: {
        canonical: `${siteUrl}/cadastro`,
    },
    openGraph: {
        title: "Cadastro | Espaço Facial",
        description:
            "Gire a Roda da Beleza da Espaço Facial, descubra seu prêmio e siga para o atendimento pelo WhatsApp.",
        url: `${siteUrl}/cadastro`,
        type: "website",
    },
};

export default function CadastroPage() {
    return (
        <>
            <Header />
            <CadastroWheelExperience whatsappPhone={cadastroWhatsappPhone} />
            <Footer />
        </>
    );
}
