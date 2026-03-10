"use client";

import Link, { type LinkProps } from "next/link";
import { type MouseEventHandler, type ReactNode } from "react";
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
        <Link
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
        </Link>
    );
}
