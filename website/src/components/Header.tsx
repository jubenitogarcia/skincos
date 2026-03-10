import Link from "next/link";
import AgendeCta from "@/components/AgendeCta";
import UnitChooser from "@/components/UnitChooser";
import HeaderInstagram from "@/components/HeaderInstagram";
import Brand from "@/components/Brand";
import HeaderMobileMenu from "@/components/HeaderMobileMenu";

export default function Header() {
  return (
    <header className="header">
      <div className="container">
        <div className="nav">
          <div className="navLeft">
            <HeaderMobileMenu />
            <Brand className="brand--header" />
          </div>

          <nav className="menu menu--center" aria-label="Menu principal">
            <Link href="/#sobre-nos">Sobre Nós</Link>
            <Link href="/#doutores">Nossos Doutores</Link>
            <Link href="/#unidades">Unidades</Link>
          </nav>

          <div className="headerActions">
            <UnitChooser />
            <HeaderInstagram />
            <AgendeCta />
          </div>
        </div>
      </div>
    </header>
  );
}
