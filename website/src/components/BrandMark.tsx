"use client";

import { useMemo, useState } from "react";
import Image from "next/image";

type Props = {
    className?: string;
    title?: string;
    tone?: "dark" | "light";
};

export default function BrandMark({ className, title = "Espaço Facial", tone = "dark" }: Props) {
    const candidates = useMemo(() => {
        if (tone === "light") {
            return ["/mark-white.png", "/mark.png"] as const;
        }

        return ["/mark.png"] as const;
    }, [tone]);

    const [candidateIndex, setCandidateIndex] = useState(0);
    const [useInlineSvg, setUseInlineSvg] = useState(false);

    // Cache-busting for edge/CDN deployments (e.g. Cloudflare) that may keep an old asset cached.
    const src = `${candidates[candidateIndex]}?v=20260120a`;
    const shouldInvert = tone === "light" && !candidates[candidateIndex].includes("white");

    if (!useInlineSvg) {
        return (
            <Image
                src={src}
                alt={title}
                className={className}
                width={484}
                height={432}
                sizes="64px"
                draggable={false}
                style={shouldInvert ? { filter: "invert(1)" } : undefined}
                onError={() => {
                    setCandidateIndex((current) => {
                        if (current < candidates.length - 1) return current + 1;
                        setUseInlineSvg(true);
                        return current;
                    });
                }}
                unoptimized
            />
        );
    }

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 484 432"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={title}
            className={className}
        >
            <g fill="currentColor">
                <rect x="0" y="0" width="484" height="62" />
                <rect x="0" y="184" width="484" height="63" />
                <rect x="0" y="184" width="63" height="248" />
                <rect x="196" y="370" width="288" height="62" />
            </g>
        </svg>
    );
}
