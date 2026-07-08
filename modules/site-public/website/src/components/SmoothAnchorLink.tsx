"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import { alignHashTarget, resolveInternalHashHref } from "@/lib/hashNavigation";

type SmoothAnchorLinkProps = ComponentProps<typeof Link>;

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export default function SmoothAnchorLink({ href, onClick, scroll, ...rest }: SmoothAnchorLinkProps) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const currentPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    const hrefString = typeof href === "string" ? href : null;
    const resolvedHashHref = hrefString ? resolveInternalHashHref(hrefString) : null;
    const shouldManageHash = !!resolvedHashHref;

    return (
        <Link
            {...rest}
            href={href}
            scroll={shouldManageHash ? false : scroll}
            onClick={(event) => {
                onClick?.(event);
                if (event.defaultPrevented || !shouldManageHash || !isPlainLeftClick(event)) return;

                const targetPath = `${resolvedHashHref.pathname}${resolvedHashHref.search}`;
                if (targetPath !== currentPath) return;

                event.preventDefault();
                window.history.pushState(null, "", resolvedHashHref.href);

                const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                alignHashTarget(resolvedHashHref.hash, reduceMotion ? "auto" : "smooth");
            }}
        />
    );
}
