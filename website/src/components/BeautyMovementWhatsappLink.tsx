"use client";

import { type AnchorHTMLAttributes, type ReactNode, useMemo } from "react";
import { buildBeautyMovementWhatsappHref, type BeautyMovementWhatsappPlacement } from "@/lib/beautyMovementWhatsapp";

type BeautyMovementWhatsappLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> & {
  children: ReactNode;
  message: string;
  placement: BeautyMovementWhatsappPlacement;
};

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
    () => buildBeautyMovementWhatsappHref({ message, placement }) ?? "#",
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
