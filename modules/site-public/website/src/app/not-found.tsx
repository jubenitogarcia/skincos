import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";

export default function NotFound() {
    return (
        <>
            <Header />
            <main className="container" style={{ paddingTop: 26 }}>
                <h1>Página não encontrada</h1>
                <p style={{ color: "#6b6b6b" }}>
                    O link que você tentou acessar não existe ou foi movido.
                </p>
                <div className="pillRow" style={{ marginTop: 16 }}>
                    <Link className="pill" href="/">Ir para Home</Link>
                    <Link className="pill" href="/unidades">Ver Unidades</Link>
                </div>
            </main>
            <Footer />
            <FloatingContact />
        </>
    );
}
