import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import BeautyMovementLocalPreview from "@/components/BeautyMovementLocalPreview";
import { isBeautyMovementLocalPreviewAllowed } from "@/lib/beautyMovementLocalPreview";

export const metadata: Metadata = {
    title: "Prévia local | Cartas da Beleza em Movimento",
    robots: {
        index: false,
        follow: false,
    },
};

/** This route is deliberately unavailable in the ordinary production configuration. */
export default async function BeautyMovementLocalPreviewPage() {
    const isProduction = process.env.NODE_ENV === "production";
    if (!isBeautyMovementLocalPreviewAllowed({ isProduction })) notFound();

    return (
        <>
            <Header preferredUnitSlug="novo-hamburgo" fixedUnitSlug="novo-hamburgo" scrollAware />
            <BeautyMovementLocalPreview />
            <Footer />
        </>
    );
}
