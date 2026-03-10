"use client";

import Link from "next/link";

export type ConversionIntentItem = {
    id: string;
    eyebrow: string;
    title: string;
    body: string;
    ctaLabel: string;
    href: string;
    kind?: "primary" | "secondary" | "ghost";
    note?: string;
    onClick?: () => void;
};

type ConversionIntentRailProps = {
    title: string;
    subtitle: string;
    items: ConversionIntentItem[];
    className?: string;
};

export default function ConversionIntentRail({ title, subtitle, items, className }: ConversionIntentRailProps) {
    return (
        <section className={`conversionRail ${className ?? ""}`.trim()} aria-label={title}>
            <div className="conversionRail__intro">
                <h2 className="sectionTitle">{title}</h2>
                <p className="sectionSub">{subtitle}</p>
            </div>

            <div className="conversionRail__grid">
                {items.map((item) => (
                    <article key={item.id} className="conversionRail__card">
                        <span className="conversionRail__eyebrow">{item.eyebrow}</span>
                        <h3>{item.title}</h3>
                        <p>{item.body}</p>
                        <Link
                            href={item.href}
                            className={`conversionRail__cta conversionRail__cta--${item.kind ?? "secondary"}`.trim()}
                            onClick={item.onClick}
                        >
                            {item.ctaLabel}
                        </Link>
                        {item.note ? <span className="conversionRail__note">{item.note}</span> : null}
                    </article>
                ))}
            </div>
        </section>
    );
}
