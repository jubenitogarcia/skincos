import { memo, type ReactNode } from "react";

type BeautyMovementCardIllustrationProps = {
    cardId: string;
};

const strokeProps = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2.4,
};

const accentStrokeProps = {
    fill: "none",
    stroke: "var(--bm-yellow)",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
};

const accentFillProps = {
    fill: "var(--bm-yellow)",
};

function Spark({ x, y, size = 7 }: { x: number; y: number; size?: number }) {
    return <path d={`M ${x} ${y - size} V ${y + size} M ${x - size} ${y} H ${x + size}`} {...strokeProps} />;
}

function AccentSpark({ x, y, size = 6 }: { x: number; y: number; size?: number }) {
    return <path d={`M ${x} ${y - size} V ${y + size} M ${x - size} ${y} H ${x + size}`} {...accentStrokeProps} />;
}

function AccentDot({ cx, cy, r = 3 }: { cx: number; cy: number; r?: number }) {
    return <circle cx={cx} cy={cy} r={r} {...accentFillProps} />;
}

function DefaultArt() {
    return (
        <>
            <circle cx="80" cy="80" r="43" {...strokeProps} />
            <circle cx="80" cy="80" r="8" fill="currentColor" />
            <path d="M 80 22 V 39 M 80 121 V 138 M 22 80 H 39 M 121 80 H 138" {...strokeProps} />
        </>
    );
}

/** Original, monochrome editorial drawings for the card concepts. */
const BeautyMovementCardIllustration = memo(function BeautyMovementCardIllustration({ cardId }: BeautyMovementCardIllustrationProps) {
    let art: ReactNode;

    switch (cardId) {
        case "beleza-presenca":
            art = (
                <>
                    <circle cx="80" cy="80" r="45" {...strokeProps} />
                    <circle cx="80" cy="80" r="17" {...strokeProps} />
                    <circle cx="80" cy="80" r="5" fill="currentColor" />
                    <path d="M 80 19 C 108 34 119 52 119 80 C 119 108 105 126 80 141" {...strokeProps} />
                    <path d="M 20 80 C 35 53 53 41 80 41" {...strokeProps} />
                    <path d="M 80 13 C 121 25 143 51 143 80" {...accentStrokeProps} opacity="0.8" />
                    <AccentDot cx={129} cy={42} r={2.8} />
                    <AccentDot cx={34} cy={116} r={2.8} />
                </>
            );
            break;
        case "beleza-autocuidado":
            art = (
                <>
                    <path d="M 37 87 H 123 L 113 115 H 47 Z" {...strokeProps} />
                    <path d="M 48 87 C 54 69 68 62 80 62 C 94 62 108 69 114 87" {...strokeProps} />
                    <path d="M 80 62 C 76 48 83 35 99 29 C 104 46 98 60 80 62 Z" {...strokeProps} />
                    <path d="M 42 125 H 118" {...strokeProps} />
                    <Spark x={42} y={45} size={6} />
                    <path d="M 80 62 C 82 48 90 38 99 29" {...accentStrokeProps} />
                    <AccentDot cx={119} cy={65} r={3} />
                    <AccentDot cx={46} cy={72} r={2.5} />
                </>
            );
            break;
        case "movimento-constancia":
            art = (
                <>
                    <path d="M 29 112 C 45 91 48 119 64 98 C 80 76 82 103 99 81 C 111 65 119 75 130 58" {...strokeProps} />
                    <circle cx="29" cy="112" r="5" fill="currentColor" />
                    <circle cx="64" cy="98" r="5" fill="currentColor" />
                    <circle cx="99" cy="81" r="5" fill="currentColor" />
                    <circle cx="130" cy="58" r="5" fill="currentColor" />
                    <path d="M 119 57 L 132 55 L 128 68" {...strokeProps} />
                    <path d="M 28 122 C 57 111 82 107 111 84" {...accentStrokeProps} opacity="0.8" />
                    <AccentDot cx={48} cy={108} r={2.5} />
                    <AccentDot cx={113} cy={74} r={2.5} />
                </>
            );
            break;
        case "movimento-potencia":
            art = (
                <>
                    <path d="M 80 23 L 91 61 L 132 64 L 100 87 L 111 127 L 80 104 L 49 127 L 60 87 L 28 64 L 69 61 Z" {...strokeProps} />
                    <circle cx="80" cy="77" r="10" fill="currentColor" />
                    <path d="M 80 23 V 12 M 28 64 L 18 59 M 132 64 L 142 59" {...strokeProps} />
                    <path d="M 80 16 V 7 M 38 56 L 30 51 M 122 56 L 130 51" {...accentStrokeProps} />
                    <AccentSpark x={80} y={137} size={5} />
                </>
            );
            break;
        case "celebracao-confianca":
            art = (
                <>
                    <path d="M 80 24 L 121 40 V 76 C 121 104 103 123 80 137 C 57 123 39 104 39 76 V 40 Z" {...strokeProps} />
                    <path d="M 80 94 C 74 88 61 80 61 70 C 61 59 75 56 80 67 C 85 56 99 59 99 70 C 99 80 86 88 80 94 Z" {...strokeProps} />
                    <path d="M 55 39 L 80 29 L 105 39" {...strokeProps} />
                    <path d="M 80 24 V 15 M 49 35 L 43 28 M 111 35 L 117 28" {...accentStrokeProps} />
                    <AccentDot cx={80} cy={105} r={3} />
                </>
            );
            break;
        case "celebracao-renovacao":
            art = (
                <>
                    <path d="M 50 56 C 60 35 89 27 109 43 C 123 54 126 75 118 92" {...strokeProps} />
                    <path d="M 110 85 L 119 96 L 104 97" {...strokeProps} />
                    <path d="M 110 104 C 100 125 71 133 51 117 C 37 106 34 85 42 68" {...strokeProps} />
                    <path d="M 50 75 L 41 64 L 56 63" {...strokeProps} />
                    <path d="M 80 115 C 75 99 80 87 95 78 C 98 95 92 108 80 115 Z" {...strokeProps} />
                    <path d="M 80 115 V 75" {...strokeProps} />
                    <path d="M 80 115 C 69 102 64 89 67 74" {...accentStrokeProps} />
                    <AccentDot cx={42} cy={68} r={2.5} />
                    <AccentDot cx={119} cy={96} r={2.5} />
                </>
            );
            break;
        case "beleza-radiancia":
            art = (
                <>
                    <circle cx="80" cy="80" r="26" fill="currentColor" />
                    <circle cx="80" cy="80" r="41" {...strokeProps} />
                    {Array.from({ length: 8 }, (_, index) => {
                        const angle = (index * Math.PI) / 4;
                        const x1 = 80 + Math.cos(angle) * 51;
                        const y1 = 80 + Math.sin(angle) * 51;
                        const x2 = 80 + Math.cos(angle) * 68;
                        const y2 = 80 + Math.sin(angle) * 68;
                        return <path key={`${x1}-${y1}`} d={`M ${x1} ${y1} L ${x2} ${y2}`} {...strokeProps} />;
                    })}
                    <AccentSpark x={43} y={80} size={5} />
                    <AccentDot cx={118} cy={43} r={3} />
                    <AccentDot cx={43} cy={118} r={3} />
                </>
            );
            break;
        case "movimento-leveza":
            art = (
                <>
                    <path d="M 31 92 C 51 52 92 35 130 48 C 111 55 99 68 91 87 C 80 112 56 119 31 112 C 43 104 45 97 31 92 Z" {...strokeProps} />
                    <path d="M 43 103 C 68 91 89 74 112 53" {...strokeProps} />
                    <path d="M 55 75 C 65 72 73 72 83 75 M 49 88 C 60 85 68 85 77 87" {...strokeProps} />
                    <Spark x={119} y={106} size={6} />
                    <path d="M 38 98 C 62 77 86 59 119 49" {...accentStrokeProps} opacity="0.8" />
                    <AccentDot cx={42} cy={62} r={2.5} />
                </>
            );
            break;
        case "celebracao-brilho":
            art = (
                <>
                    <path d="M 80 19 L 88 67 L 135 80 L 88 92 L 80 141 L 72 92 L 25 80 L 72 67 Z" {...strokeProps} />
                    <circle cx="80" cy="80" r="9" fill="currentColor" />
                    <Spark x={42} y={42} size={5} />
                    <Spark x={119} y={45} size={5} />
                    <Spark x={119} y={119} size={5} />
                    <path d="M 80 10 V 26 M 18 80 H 34 M 126 80 H 142" {...accentStrokeProps} />
                    <AccentDot cx={40} cy={119} r={3} />
                </>
            );
            break;
        case "beleza-autoria":
            art = (
                <>
                    <path d="M 32 105 C 53 77 75 62 120 48 C 111 74 91 102 62 119 C 49 126 37 119 32 105 Z" {...strokeProps} />
                    <path d="M 48 111 L 110 58" {...strokeProps} />
                    <path d="M 113 47 L 128 32 L 132 50 L 120 60 Z" {...strokeProps} />
                    <path d="M 35 129 C 65 136 97 128 119 111" {...strokeProps} />
                    <path d="M 42 118 L 108 58" {...accentStrokeProps} />
                    <AccentDot cx={119} cy={42} r={3} />
                </>
            );
            break;
        case "movimento-ritmo":
            art = (
                <>
                    <path d="M 22 67 C 37 48 52 48 67 67 C 82 86 97 86 112 67 C 123 53 132 53 140 62" {...strokeProps} />
                    <path d="M 22 94 C 37 75 52 75 67 94 C 82 113 97 113 112 94 C 123 80 132 80 140 89" {...strokeProps} />
                    <circle cx="44" cy="54" r="5" fill="currentColor" />
                    <circle cx="80" cy="80" r="5" fill="currentColor" />
                    <circle cx="116" cy="106" r="5" fill="currentColor" />
                    <path d="M 23 55 H 41 M 77 80 H 95 M 113 105 H 137" {...accentStrokeProps} />
                    <AccentDot cx={134} cy={48} r={3} />
                </>
            );
            break;
        case "celebracao-impulso":
            art = (
                <>
                    <path d="M 24 115 C 54 108 75 91 91 64 C 101 47 113 35 134 29" {...strokeProps} />
                    <path d="M 118 26 L 136 28 L 131 45" {...strokeProps} />
                    <circle cx="34" cy="113" r="7" fill="currentColor" />
                    <circle cx="63" cy="98" r="5" fill="currentColor" />
                    <circle cx="88" cy="69" r="4" fill="currentColor" />
                    <Spark x={123} y={93} size={6} />
                    <path d="M 28 126 C 60 119 92 94 127 38" {...accentStrokeProps} opacity="0.78" />
                    <AccentDot cx={107} cy={48} r={3} />
                </>
            );
            break;
        case "beleza-harmonia":
            art = (
                <>
                    <circle cx="64" cy="80" r="35" {...strokeProps} />
                    <circle cx="96" cy="80" r="35" {...strokeProps} />
                    <path d="M 80 52 C 88 63 88 97 80 108 C 72 97 72 63 80 52 Z" fill="currentColor" opacity="0.75" />
                    <circle cx="80" cy="80" r="5" fill="currentColor" />
                    <path d="M 80 39 V 28 M 80 121 V 132" {...accentStrokeProps} />
                    <AccentDot cx={45} cy={80} r={3} />
                    <AccentDot cx={115} cy={80} r={3} />
                </>
            );
            break;
        case "movimento-sintonia":
            art = (
                <>
                    <circle cx="80" cy="80" r="10" fill="currentColor" />
                    <circle cx="80" cy="80" r="28" {...strokeProps} />
                    <circle cx="80" cy="80" r="47" {...strokeProps} />
                    <path d="M 31 80 H 17 M 129 80 H 143" {...strokeProps} />
                    <circle cx="31" cy="80" r="5" fill="currentColor" />
                    <circle cx="129" cy="80" r="5" fill="currentColor" />
                    <path d="M 80 15 V 28 M 80 132 V 145" {...accentStrokeProps} />
                    <AccentDot cx={41} cy={53} r={3} />
                    <AccentDot cx={119} cy={107} r={3} />
                </>
            );
            break;
        case "celebracao-encontro":
            art = (
                <>
                    <circle cx="58" cy="80" r="31" {...strokeProps} />
                    <circle cx="102" cy="80" r="31" {...strokeProps} />
                    <path d="M 80 48 C 67 62 67 98 80 112 C 93 98 93 62 80 48 Z" fill="currentColor" opacity="0.72" />
                    <path d="M 47 125 C 63 136 97 136 113 125" {...strokeProps} />
                    <Spark x={80} y={31} size={6} />
                    <path d="M 38 80 C 52 64 65 57 80 57 C 95 57 108 64 122 80" {...accentStrokeProps} opacity="0.78" />
                    <AccentDot cx={80} cy={132} r={3} />
                </>
            );
            break;
        case "reward-reserved":
            art = (
                <>
                    <rect x="39" y="36" width="82" height="88" rx="10" {...strokeProps} />
                    <path d="M 54 63 H 106 M 54 82 H 94 M 54 101 H 82" {...strokeProps} />
                    <path d="M 80 22 V 39 M 80 121 V 138" {...accentStrokeProps} />
                    <AccentDot cx={38} cy={48} r={3} />
                    <AccentDot cx={122} cy={112} r={3} />
                </>
            );
            break;
        case "reward-procedure":
            art = (
                <>
                    <circle cx="80" cy="75" r="42" {...strokeProps} />
                    <path d="M 64 110 L 58 139 L 80 127 L 102 139 L 96 110" {...strokeProps} />
                    <path d="M 80 46 L 87 67 L 109 68 L 92 81 L 98 103 L 80 90 L 62 103 L 68 81 L 51 68 L 73 67 Z" {...accentStrokeProps} />
                    <AccentDot cx={39} cy={42} r={3} />
                    <AccentDot cx={121} cy={42} r={3} />
                </>
            );
            break;
        case "reward-discount":
            art = (
                <>
                    <path d="M 30 55 L 62 28 H 126 V 92 L 94 124 H 30 Z" {...strokeProps} />
                    <circle cx="103" cy="52" r="6" {...accentFillProps} />
                    <path d="M 50 100 L 104 46" {...accentStrokeProps} />
                    <circle cx="57" cy="75" r="7" {...strokeProps} />
                    <circle cx="94" cy="96" r="7" {...strokeProps} />
                    <path d="M 30 55 V 124 H 94" {...accentStrokeProps} opacity="0.8" />
                </>
            );
            break;
        case "reward-velocity":
            art = (
                <>
                    <circle cx="80" cy="80" r="48" {...strokeProps} />
                    <path d="M 49 50 L 63 110 L 80 80 L 97 110 L 111 50" {...strokeProps} />
                    <path d="M 22 128 C 47 143 113 143 138 128" {...accentStrokeProps} />
                    <path d="M 31 32 C 56 16 104 16 129 32" {...accentStrokeProps} opacity="0.78" />
                    <AccentDot cx={35} cy={128} r={3} />
                    <AccentDot cx={125} cy={128} r={3} />
                </>
            );
            break;
        default:
            art = <DefaultArt />;
    }

    return (
        <svg className="beautyMovementCardIllustration" viewBox="0 0 160 160" role="presentation" aria-hidden="true">
            {art}
        </svg>
    );
});

BeautyMovementCardIllustration.displayName = "BeautyMovementCardIllustration";

export default BeautyMovementCardIllustration;
