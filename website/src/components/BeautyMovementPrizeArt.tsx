import { memo } from "react";
import Image from "next/image";
import type { BeautyMovementOutcomeKey } from "@/lib/beautyMovementOutcomes";

type BeautyMovementPrizeArtProps = {
    outcomeKey: BeautyMovementOutcomeKey;
};

export const BEAUTY_MOVEMENT_PRIZE_ART_BY_OUTCOME: Readonly<Record<BeautyMovementOutcomeKey, string>> = {
    elleva_upgrade: "/images/beauty-movement/rewards/elleva-upgrade-cutout.webp",
    filler_double: "/images/beauty-movement/rewards/filler-double-cutout.webp",
    sculptra_classic_unlock: "/images/beauty-movement/rewards/sculptra-classic-unlock-cutout.webp",
    skinbooster_diamond_unlock: "/images/beauty-movement/rewards/skinbooster-diamond-unlock-cutout.webp",
};

const BeautyMovementPrizeArt = memo(function BeautyMovementPrizeArt({ outcomeKey }: BeautyMovementPrizeArtProps) {
    return (
        <Image
            className="beautyMovementPrizeArt"
            src={BEAUTY_MOVEMENT_PRIZE_ART_BY_OUTCOME[outcomeKey]}
            alt=""
            aria-hidden="true"
            width={384}
            height={384}
            sizes="(max-width: 720px) 174px, 122px"
            unoptimized
            draggable={false}
        />
    );
});

BeautyMovementPrizeArt.displayName = "BeautyMovementPrizeArt";

export default BeautyMovementPrizeArt;
