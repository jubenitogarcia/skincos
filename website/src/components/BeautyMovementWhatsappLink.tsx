"use client";

import { type AnchorHTMLAttributes, type ReactNode, useMemo } from "react";
import { buildWhatsappRedirectHref } from "@/lib/whatsappTracking";

type BeautyMovementWhatsappLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> & {
  children: ReactNode;
  message: string;
  placement: "result" | "conditions";
};

function buildHref(params: {
  message: string;
  placement: BeautyMovementWhatsappLinkProps["placement"];
}): string {
  return (
    buildWhatsappRedirectHref({
      phone: "5551995811008",
      text: params.message,
      tracking: {
        placement: `beauty_movement_${params.placement}`,
        unitSlug: "novo-hamburgo",
        source: "beauty-movement",
        // The redirect identifies the campaign but never receives a location,
        // attribution context, event id, or personal campaign state.
      },
    }) ?? "#"
  );
}

/**
 * Uses the existing first-party WhatsApp redirect without invoking the generic
 * conversion component. The campaign MVP has no Meta/Google conversion event.
 */
export default function BeautyMovementWhatsappLink({
  children,
  message,
  placement,
  onClick,
  target,
  rel,
  ...rest
}: BeautyMovementWhatsappLinkProps) {
  const href = useMemo(
    () => buildHref({ message, placement }),
    [message, placement],
  );

  return (
    <a
      {...rest}
      href={href}
      data-tracking-skip="true"
      target={target}
      rel={rel ?? (target === "_blank" ? "noopener noreferrer" : undefined)}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
