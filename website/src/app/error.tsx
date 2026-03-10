"use client";

import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <>
            <Header />
            <main className="container" style={{ paddingTop: 26 }}>
                <h1>Ocorreu um problema</h1>
                <p style={{ color: "#6b6b6b" }}>
                    Tente novamente. Se o erro persistir, entre em contato com a unidade.
                </p>
                <div className="pillRow" style={{ marginTop: 16 }}>
                    <button className="pill" onClick={() => reset()} type="button">
                        Tentar novamente
                    </button>
                    <Link className="pill" href="/unidades">
                        Ver unidades
                    </Link>
                </div>
                <p className="small" style={{ marginTop: 14 }}>
                    {/* Ajuda diagnóstico sem expor detalhes ao usuário final */}
                    Código: {error.digest ?? "n/a"}
                </p>
            </main>
            <Footer />
            <FloatingContact />
        </>
    );
}
