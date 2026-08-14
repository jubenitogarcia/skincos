import { memo, type ReactNode } from "react";

type BeautyMovementCardIllustrationProps = {
    cardId: string;
};

const lineProps = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.9,
};

const softLineProps = {
    ...lineProps,
    opacity: 0.46,
    strokeWidth: 1.15,
};

const pulseLineProps = {
    fill: "none",
    stroke: "var(--bm-yellow)",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
};

function Pulse({ x, y, r = 3 }: { x: number; y: number; r?: number }) {
    return <circle cx={x} cy={y} r={r} fill="var(--bm-yellow)" />;
}

function QuietContour() {
    return (
        <>
            <path d="M 34 126 C 42 87 57 51 102 34 C 119 28 132 30 140 36" {...lineProps} />
            <path d="M 44 133 C 52 95 71 67 108 54 C 123 49 133 50 142 55" {...softLineProps} />
            <path d="M 57 137 C 66 107 84 85 111 76 C 123 72 132 73 139 77" {...softLineProps} />
            <path d="M 25 47 H 49 M 25 54 H 43 M 25 61 H 37" {...lineProps} />
            <path d="M 49 126 C 73 126 84 128 99 140" {...pulseLineProps} />
            <Pulse x={104} y={140} r={2.7} />
        </>
    );
}

function VeinField() {
    return (
        <>
            <path d="M 33 125 C 49 91 68 62 122 37" {...lineProps} />
            <path d="M 45 116 C 66 99 79 76 87 51 M 59 127 C 82 111 101 84 111 57" {...softLineProps} />
            <path d="M 63 103 C 74 96 84 94 96 95 M 76 80 C 88 73 100 71 114 73" {...softLineProps} />
            <path d="M 28 136 C 61 133 101 119 137 91" {...softLineProps} />
            <path d="M 116 38 C 125 35 133 34 140 35" {...pulseLineProps} />
            <Pulse x={121} y={37} r={3} />
        </>
    );
}

function MeasuredPulse() {
    return (
        <>
            <path d="M 23 66 H 52 C 63 66 66 94 80 94 C 94 94 97 66 108 66 H 139" {...lineProps} />
            <path d="M 23 86 H 45 C 58 86 62 111 80 111 C 98 111 102 86 115 86 H 139" {...softLineProps} />
            <path d="M 23 106 H 38 C 52 106 59 128 80 128 C 101 128 108 106 122 106 H 139" {...softLineProps} />
            <path d="M 23 48 H 73" {...softLineProps} />
            <path d="M 24 66 H 47" {...pulseLineProps} />
            <Pulse x={52} y={66} r={3} />
            <Pulse x={80} y={94} r={2.6} />
            <Pulse x={108} y={66} r={2.2} />
        </>
    );
}

function RisingTrace() {
    return (
        <>
            <path d="M 28 128 C 49 119 59 109 72 87 C 88 60 102 49 132 31" {...lineProps} />
            <path d="M 28 138 C 57 130 78 110 93 85 C 105 66 118 52 137 42" {...softLineProps} />
            <path d="M 46 104 C 60 109 70 109 82 103 M 69 77 C 83 82 96 80 107 71" {...softLineProps} />
            <path d="M 117 40 C 124 36 132 32 141 29" {...pulseLineProps} />
            <Pulse x={119} y={40} r={3} />
        </>
    );
}

function Convergence() {
    return (
        <>
            <path d="M 25 38 C 48 42 63 53 80 78 C 95 100 112 116 138 123" {...lineProps} />
            <path d="M 25 57 C 47 60 61 69 78 87 C 96 107 112 119 138 127" {...softLineProps} />
            <path d="M 25 78 C 43 80 56 87 72 100 C 91 115 112 126 138 132" {...softLineProps} />
            <path d="M 25 101 C 44 101 57 105 75 115 C 92 125 112 134 138 137" {...softLineProps} />
            <path d="M 25 38 H 49" {...pulseLineProps} />
            <Pulse x={54} y={43} r={3} />
            <Pulse x={80} y={78} r={2.6} />
            <Pulse x={112} y={116} r={2.2} />
        </>
    );
}

function QuietOrbit() {
    return (
        <>
            <path d="M 47 49 C 65 30 99 28 119 45 C 139 62 137 94 118 112 C 100 129 66 132 46 114 C 27 97 28 67 47 49 Z" {...lineProps} />
            <path d="M 56 58 C 71 43 96 42 110 55 C 124 68 123 91 109 104 C 94 117 70 118 56 105 C 42 92 42 72 56 58 Z" {...softLineProps} />
            <path d="M 39 121 C 59 113 73 107 86 94 C 100 80 108 62 113 40" {...lineProps} />
            <path d="M 39 121 C 48 122 57 124 66 129" {...pulseLineProps} />
            <Pulse x={70} y={131} r={2.8} />
        </>
    );
}

function ReservedField() {
    return (
        <>
            <path d="M 35 36 H 125 V 124 H 35 Z" {...lineProps} />
            <path d="M 48 51 H 112 M 48 65 H 99 M 48 79 H 106 M 48 93 H 84" {...softLineProps} />
            <path d="M 48 108 C 63 91 81 88 112 91" {...lineProps} />
            <path d="M 48 108 C 60 105 69 106 79 113" {...pulseLineProps} />
            <Pulse x={83} y={115} r={2.8} />
        </>
    );
}

function DefaultArt() {
    return (
        <>
            <path d="M 31 80 H 53 C 65 80 67 58 80 58 C 93 58 95 102 108 102 H 129" {...lineProps} />
            <path d="M 31 99 H 51 C 66 99 68 76 80 76 C 92 76 95 119 111 119 H 129" {...softLineProps} />
            <path d="M 43 43 V 67 M 50 43 V 61 M 57 43 V 55" {...softLineProps} />
            <Pulse x={108} y={102} r={3} />
        </>
    );
}

/** Original campaign drawings: bar, organic trace and three changing pulses. */
const BeautyMovementCardIllustration = memo(function BeautyMovementCardIllustration({ cardId }: BeautyMovementCardIllustrationProps) {
    let art: ReactNode;

    switch (cardId) {
        case "beleza-presenca":
        case "beleza-radiancia":
        case "beleza-harmonia":
            art = <QuietContour />;
            break;
        case "beleza-autocuidado":
        case "beleza-autoria":
        case "celebracao-renovacao":
            art = <VeinField />;
            break;
        case "movimento-constancia":
        case "movimento-ritmo":
        case "movimento-sintonia":
            art = <MeasuredPulse />;
            break;
        case "movimento-potencia":
        case "celebracao-impulso":
            art = <RisingTrace />;
            break;
        case "celebracao-confianca":
        case "celebracao-encontro":
            art = <Convergence />;
            break;
        case "movimento-leveza":
        case "celebracao-brilho":
            art = <QuietOrbit />;
            break;
        case "reward-reserved":
            art = <ReservedField />;
            break;
        case "reward-procedure":
            art = <Convergence />;
            break;
        case "reward-discount":
            art = <MeasuredPulse />;
            break;
        case "reward-velocity":
            art = <RisingTrace />;
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
