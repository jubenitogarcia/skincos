import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import BeautyMovementLocalPreview from "@/components/BeautyMovementLocalPreview";

export const metadata: Metadata = {
    title: "Prévia local | Cartas da Beleza em Movimento",
    robots: {
        index: false,
        follow: false,
    },
};

/** This route is deliberately unavailable in the ordinary production configuration. */
export default function BeautyMovementLocalPreviewPage() {
    if (process.env.NODE_ENV === "production" && process.env.SKINCOS_LOCAL_PREVIEW !== "true") notFound();

    return (
        <>
            <Header preferredUnitSlug="novo-hamburgo" fixedUnitSlug="novo-hamburgo" scrollAware />
            <BeautyMovementLocalPreview />
            <Footer />
        </>
    );
}
