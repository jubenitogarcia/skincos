"use client";

import { units } from "@/data/units";
import { trackEvent } from "@/lib/analytics";
import { setStoredUnitSlug } from "@/lib/unitSelection";

const QUICK_UNIT_SLUGS = ["novo-hamburgo", "barrashoppingsul"] as const;
const QUICK_UNIT_LABELS: Record<(typeof QUICK_UNIT_SLUGS)[number], string> = {
    "novo-hamburgo": "NH",
    barrashoppingsul: "BSS",
};

type UnitQuickButtonsProps = {
    placement: string;
};

export default function UnitQuickButtons({ placement }: UnitQuickButtonsProps) {
    const items = QUICK_UNIT_SLUGS.map((slug) => {
        const unit = units.find((u) => u.slug === slug);
        if (!unit) return null;
        return {
            slug,
            label: QUICK_UNIT_LABELS[slug],
            name: unit.name,
        };
    }).filter(Boolean);

    if (!items.length) return null;

    return (
        <div className="unitQuickButtons" role="group" aria-label="Selecionar unidade">
            {items.map((item) => {
                const unit = item!;
                return (
                    <button
                        key={unit.slug}
                        type="button"
                        className="unitQuickButton"
                        aria-label={`Selecionar ${unit.name}`}
                        title={unit.name}
                        onClick={() => {
                            setStoredUnitSlug(unit.slug);
                            trackEvent("unit_select", { unitSlug: unit.slug, placement });
                        }}
                    >
                        {unit.label}
                    </button>
                );
            })}
        </div>
    );
}
