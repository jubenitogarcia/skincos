import AgendeCta from "@/components/AgendeCta";
import UnitChooser from "@/components/UnitChooser";
import Brand from "@/components/Brand";
import HeaderMobileMenu from "@/components/HeaderMobileMenu";
import SmoothAnchorLink from "@/components/SmoothAnchorLink";

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
            <SmoothAnchorLink href="/#sobre-nos">Sobre Nós</SmoothAnchorLink>
            <SmoothAnchorLink href="/#doutores">Equipe</SmoothAnchorLink>
            <SmoothAnchorLink href="/#unidades">Unidades</SmoothAnchorLink>
          </nav>

          <div className="headerActions">
            <UnitChooser />
            <AgendeCta />
          </div>
        </div>
      </div>
    </header>
  );
}
