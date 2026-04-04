"use client";

import { DIGITAL_JOURNEY_UNIT_BADGES, getDigitalJourneyUnits } from "@/data/units";
import { trackEvent } from "@/lib/analytics";
import { setStoredUnitSlug } from "@/lib/unitSelection";

type UnitQuickButtonsProps = {
    placement: string;
};

export default function UnitQuickButtons({ placement }: UnitQuickButtonsProps) {
    const items = getDigitalJourneyUnits()
        .map((unit) => {
            const label = DIGITAL_JOURNEY_UNIT_BADGES[unit.slug as keyof typeof DIGITAL_JOURNEY_UNIT_BADGES];
            if (!label) return null;

            return {
                slug: unit.slug,
                label,
                name: unit.name,
            };
        })
        .filter(Boolean);

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
