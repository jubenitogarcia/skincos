import Brand from "@/components/Brand";
import CookiePreferencesLink from "@/components/CookiePreferencesLink";
import Link from "next/link";
import type { SiteKey } from "@/lib/site-config";

export default function Footer({ siteKey = "espacofacial" }: { siteKey?: SiteKey }) {
  const year = new Date().getFullYear();

  if (siteKey === "skincos") {
    return (
      <footer className="footer">
        <div className="container footerContainer">
          <div className="footerInner">
            <div className="footerMeta">
              <div>Copyright © 2019-{year} - SKINCOS. Todos os direitos reservados.</div>
              <div className="footerSmall">
                ORB by SKINCOS · Utilitários e produtividade · Integrações com Meta
              </div>
              <div className="footerSmall" style={{ marginTop: 10 }}>
                <Link href="/privacidade" style={{ textDecoration: "underline" }}>
                  Política de Privacidade
                </Link>
                {" · "}
                <Link href="/dados" style={{ textDecoration: "underline" }}>
                  Exclusão de Dados
                </Link>
                {" · "}
                <Link href="/termos" style={{ textDecoration: "underline" }}>
                  Termos de Serviço
                </Link>
              </div>
            </div>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="footer">
      <div className="container footerContainer">
        <div className="footerInner">
          <div className="footerBrand">
            <Brand className="brand--footer" variant="full" showTagline tone="light" />
          </div>

          <div className="footerMeta">
            <div>Copyright © 2019-{year} - Espaço Facial. Todos Direitos Reservados.</div>
            <div className="footerSmall">
              50.090.741/0001-89 &nbsp;&nbsp; Skincare &amp; Cosmetics Ltda. <br />
              54.425.741/0001-43 &nbsp;&nbsp; Skincare &amp; Cosmetics POA Ltda.
            </div>
            <div className="footerSmall" style={{ marginTop: 10 }}>
              <Link href="/privacidade" style={{ textDecoration: "underline" }}>Privacidade e Cookies</Link>
              {" · "}
              <CookiePreferencesLink />
              {" · "}
              <Link href="/termos" style={{ textDecoration: "underline" }}>Termos de Uso</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
