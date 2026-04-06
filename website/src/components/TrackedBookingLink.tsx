"use client";

import { type LinkProps } from "next/link";
import { type MouseEventHandler, type ReactNode } from "react";
import SmoothAnchorLink from "@/components/SmoothAnchorLink";
import { trackBookingStart, type LeadPlacement } from "@/lib/leadTracking";

type TrackedBookingLinkProps = LinkProps & {
    children: ReactNode;
    className?: string;
    placement: LeadPlacement;
    unitSlug?: string | null;
    doctorName?: string;
    experience?: string;
    variant?: string;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
};

export default function TrackedBookingLink({
    children,
    className,
    placement,
    unitSlug = null,
    doctorName,
    experience,
    variant,
    onClick,
    href,
    ...rest
}: TrackedBookingLinkProps) {
    return (
        <SmoothAnchorLink
            {...rest}
            href={href}
            className={className}
            onClick={(event) => {
                onClick?.(event);
                trackBookingStart({
                    placement,
                    unitSlug,
                    doctorName,
                    bookingUrl: typeof href === "string" ? href : undefined,
                    experience,
                    variant,
                });
            }}
        >
            {children}
        </SmoothAnchorLink>
    );
}
