"use client";

import HeroMedia from "@/components/HeroMedia";
import ExperienceTracker from "@/components/ExperienceTracker";
import PageTitleBand from "@/components/PageTitleBand";
import type { HeroMediaItem, HeroMediaVariant } from "@/lib/heroMediaShared";

type HomeHeroExperienceProps = {
    heroItems: HeroMediaItem[];
    heroItemsByVariant?: Partial<Record<HeroMediaVariant, HeroMediaItem[]>>;
    initialMediaVariant: HeroMediaVariant;
    initialUnitSlug?: string | null;
};

const EXPERIENCE_KEY = "home_public_v1";
const EXPERIENCE_VARIANT = "canonical";

export default function HomeHeroExperience({ heroItems, heroItemsByVariant, initialMediaVariant, initialUnitSlug = null }: HomeHeroExperienceProps) {
    return (
        <>
            <ExperienceTracker page="/" experience={EXPERIENCE_KEY} variant={EXPERIENCE_VARIANT} />

            <PageTitleBand title="Harmonização facial com naturalidade" ariaLabel="Título da página inicial" />

            <section className="hero hero--experience hero--value-led" aria-label="Destaque">
                <HeroMedia
                    initialItems={heroItems}
                    initialItemsByVariant={heroItemsByVariant}
                    initialVariant={initialMediaVariant}
                    initialUnitSlug={initialUnitSlug}
                />
            </section>
        </>
    );
}
