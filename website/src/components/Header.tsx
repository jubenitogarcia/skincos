import AgendeCta from "@/components/AgendeCta";
import UnitChooser from "@/components/UnitChooser";
import Brand from "@/components/Brand";
import HeaderMobileMenu from "@/components/HeaderMobileMenu";
import HeaderScrollBehavior from "@/components/HeaderScrollBehavior";
import SmoothAnchorLink from "@/components/SmoothAnchorLink";

type HeaderProps = {
  preferredUnitSlug?: string | null;
  fixedUnitSlug?: string | null;
  scrollAware?: boolean;
};

export default function Header({ preferredUnitSlug = null, fixedUnitSlug = null, scrollAware = false }: HeaderProps) {
  return (
    <>
      <header className="header" data-scroll-aware-header={scrollAware ? "true" : undefined}>
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
              <UnitChooser preferredUnitSlug={preferredUnitSlug} fixedUnitSlug={fixedUnitSlug} />
              <AgendeCta preferredUnitSlug={preferredUnitSlug} fixedUnitSlug={fixedUnitSlug} />
            </div>
          </div>
        </div>
      </header>
      {scrollAware ? <HeaderScrollBehavior /> : null}
    </>
  );
}
