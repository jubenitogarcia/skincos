import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";

export default function Loading() {
    return (
        <>
            <Header />
            <main className="container" style={{ paddingTop: 26 }}>
                <p className="small">Carregando…</p>
                <div className="card" style={{ marginTop: 14 }}>
                    <p style={{ margin: 0, color: "#6b6b6b" }}>Preparando conteúdo.</p>
                </div>
            </main>
            <Footer />
            <FloatingContact />
        </>
    );
}
