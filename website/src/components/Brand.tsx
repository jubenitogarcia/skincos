import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import BrandLogo from "@/components/BrandLogo";

type Props = {
    href?: string;
    className?: string;
    showTagline?: boolean;
    variant?: "auto" | "full" | "mark";
    tone?: "dark" | "light";
};

export default function Brand({
    href = "/",
    className = "",
    showTagline = false,
    variant = "auto",
    tone = "dark",
}: Props) {
    return (
        <Link className={`brand ${className}`.trim()} href={href} aria-label="Espaço Facial - Página inicial">
            {variant === "mark" ? <BrandMark className="brandMark" tone={tone} /> : null}

            {variant === "full" ? <BrandLogo className="brandLogo" tone={tone} /> : null}

            {variant === "auto" ? (
                <>
                    <BrandMark className="brandMark brandMarkAuto" tone={tone} />
                    <BrandLogo className="brandLogo brandLogoAuto" tone={tone} />
                </>
            ) : null}

            {showTagline ? <span className="srOnly">Harmonização facial</span> : null}
        </Link>
    );
}
