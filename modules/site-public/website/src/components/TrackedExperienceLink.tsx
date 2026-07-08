"use client";

import { type LinkProps } from "next/link";
import { type MouseEventHandler, type ReactNode } from "react";
import SmoothAnchorLink from "@/components/SmoothAnchorLink";
import { trackExperienceShortcutClick, type LeadPlacement } from "@/lib/leadTracking";

type TrackedExperienceLinkProps = LinkProps & {
    children: ReactNode;
    className?: string;
    page: string;
    shortcut: string;
    placement: LeadPlacement;
    destination?: string;
    unitSlug?: string | null;
    experience?: string;
    variant?: string;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
};

export default function TrackedExperienceLink({
    children,
    className,
    page,
    shortcut,
    placement,
    destination,
    unitSlug = null,
    experience,
    variant,
    onClick,
    href,
    ...rest
}: TrackedExperienceLinkProps) {
    const resolvedDestination = destination ?? (typeof href === "string" ? href : page);

    return (
        <SmoothAnchorLink
            {...rest}
            href={href}
            className={className}
            onClick={(event) => {
                onClick?.(event);
                trackExperienceShortcutClick({
                    page,
                    shortcut,
                    destination: resolvedDestination,
                    placement,
                    unitSlug,
                    experience,
                    variant,
                });
            }}
        >
            {children}
        </SmoothAnchorLink>
    );
}
