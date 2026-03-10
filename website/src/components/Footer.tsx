import Brand from "@/components/Brand";
import CookiePreferencesLink from "@/components/CookiePreferencesLink";
import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div className="container">
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
