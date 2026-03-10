"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/analytics";

function menuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M4 7.25C4 6.56 4.56 6 5.25 6h13.5c.69 0 1.25.56 1.25 1.25S19.44 8.5 18.75 8.5H5.25C4.56 8.5 4 7.94 4 7.25Zm0 5.5C4 12.06 4.56 11.5 5.25 11.5h13.5c.69 0 1.25.56 1.25 1.25S19.44 14 18.75 14H5.25C4.56 14 4 13.44 4 12.75Zm1.25 4.25C4.56 17 4 17.56 4 18.25S4.56 19.5 5.25 19.5h13.5c.69 0 1.25-.56 1.25-1.25S19.44 17 18.75 17H5.25Z"
      />
    </svg>
  );
}

function closeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12l-4.9 4.89a1 1 0 1 0 1.41 1.42L12 13.41l4.89 4.9a1 1 0 0 0 1.42-1.41L13.41 12l4.9-4.89a1 1 0 0 0-.01-1.4Z"
      />
    </svg>
  );
}

function getFocusable(root: HTMLElement): HTMLElement[] {
  const selectors =
    'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(selectors)).filter((el) => !el.hasAttribute("disabled"));
}

export default function HeaderMobileMenu() {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  const links = useMemo(
    () => [
      { href: "/#sobre-nos", label: "Sobre Nós" },
      { href: "/#doutores", label: "Nossos Doutores" },
      { href: "/#unidades", label: "Unidades" },
    ],
    [],
  );

  // Close the menu on route changes (including when navigating to /agendamento).
  useEffect(() => {
    if (!open) return;
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    trackEvent("mobile_menu_open", { placement: "header" });

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the first item when opening.
    const panel = panelRef.current;
    if (panel) {
      const items = getFocusable(panel);
      items[0]?.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const panelEl = panelRef.current;
      if (!panelEl) return;
      const focusables = getFocusable(panelEl);
      if (focusables.length === 0) return;
      const current = document.activeElement as HTMLElement | null;
      const idx = current ? focusables.indexOf(current) : -1;
      const nextIdx = (() => {
        if (e.shiftKey) return idx <= 0 ? focusables.length - 1 : idx - 1;
        return idx === -1 || idx >= focusables.length - 1 ? 0 : idx + 1;
      })();
      focusables[nextIdx]?.focus();
      e.preventDefault();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    // Restore focus to the opener.
    buttonRef.current?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="iconBtn mobileNavBtn"
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => setOpen((v) => !v)}
      >
        {menuIcon()}
      </button>

      {open ? (
        <div
          id={dialogId}
          className="mobileNavOverlay"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div ref={panelRef} className="mobileNavPanel">
            <div className="mobileNavTop">
              <div className="mobileNavTitle">Menu</div>
              <button type="button" className="iconBtn" aria-label="Fechar menu" onClick={() => setOpen(false)}>
                {closeIcon()}
              </button>
            </div>

            <nav className="mobileNavLinks" aria-label="Navegacao">
              {links.map((l) => (
                <Link key={l.href} className="mobileNavLink" href={l.href} onClick={() => setOpen(false)}>
                  {l.label}
                </Link>
              ))}

              <Link className="mobileNavLink mobileNavLink--primary" href="/agendamento" onClick={() => setOpen(false)}>
                Agendar
              </Link>
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
