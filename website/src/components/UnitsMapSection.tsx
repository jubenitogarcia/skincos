"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import brazilMap from "@svg-maps/brazil";
import { units } from "@/data/units";
import { trackEvent } from "@/lib/analytics";

type ProjectedPoint = {
    x: number;
    y: number;
};

type TooltipState =
    | {
        uf: string;
        left: number;
        top: number;
        side: "left" | "right";
    }
    | null;

const BRAZIL_VIEWBOX = (() => {
    const parts = (brazilMap.viewBox ?? "0 0 1000 1000").split(" ").map((v: string) => Number(v));
    const [minX, minY, width, height] = parts.length === 4 && parts.every((n: number) => Number.isFinite(n)) ? parts : [0, 0, 1000, 1000];
    return { minX, minY, width, height };
})();

function projectLatLngToBrazilSvg(lat: number, lng: number): ProjectedPoint {
    // Approximate bounds for Brazil (equirectangular projection)
    const minLng = -74;
    const maxLng = -34;
    const minLat = -34;
    const maxLat = 6;

    const nx = (lng - minLng) / (maxLng - minLng);
    const ny = (maxLat - lat) / (maxLat - minLat);

    const padX = BRAZIL_VIEWBOX.width * 0.04;
    const padY = BRAZIL_VIEWBOX.height * 0.04;

    const x = BRAZIL_VIEWBOX.minX + padX + nx * (BRAZIL_VIEWBOX.width - padX * 2);
    const y = BRAZIL_VIEWBOX.minY + padY + ny * (BRAZIL_VIEWBOX.height - padY * 2);

    return {
        x: Math.max(BRAZIL_VIEWBOX.minX, Math.min(BRAZIL_VIEWBOX.minX + BRAZIL_VIEWBOX.width, x)),
        y: Math.max(BRAZIL_VIEWBOX.minY, Math.min(BRAZIL_VIEWBOX.minY + BRAZIL_VIEWBOX.height, y)),
    };
}

function getUnitDestination(unit: (typeof units)[number]): string {
    return `/${unit.slug}`;
}

function computeStatePoint(stateUnits: (typeof units)[number][]): { x: number; y: number } {
    const withCoords = stateUnits.filter((u) => typeof u.lat === "number" && typeof u.lng === "number");
    if (withCoords.length === 0) return { x: 500, y: 500 };
    const avgLat = withCoords.reduce((acc, u) => acc + (u.lat as number), 0) / withCoords.length;
    const avgLng = withCoords.reduce((acc, u) => acc + (u.lng as number), 0) / withCoords.length;
    return projectLatLngToBrazilSvg(avgLat, avgLng);
}

const STATE_NAME_BY_UF: Record<string, string> = {
    AC: "Acre",
    AL: "Alagoas",
    AP: "Amapá",
    AM: "Amazonas",
    BA: "Bahia",
    CE: "Ceará",
    DF: "Distrito Federal",
    ES: "Espírito Santo",
    GO: "Goiás",
    MA: "Maranhão",
    MT: "Mato Grosso",
    MS: "Mato Grosso do Sul",
    MG: "Minas Gerais",
    PA: "Pará",
    PB: "Paraíba",
    PR: "Paraná",
    PE: "Pernambuco",
    PI: "Piauí",
    RJ: "Rio de Janeiro",
    RN: "Rio Grande do Norte",
    RS: "Rio Grande do Sul",
    RO: "Rondônia",
    RR: "Roraima",
    SC: "Santa Catarina",
    SP: "São Paulo",
    SE: "Sergipe",
    TO: "Tocantins",
};

const FEATURED_UNIT_SLUGS = ["novo-hamburgo", "barrashoppingsul"] as const;
const FEATURED_UNIT_TAGS: Record<(typeof FEATURED_UNIT_SLUGS)[number], string> = {
    "novo-hamburgo": "NH",
    barrashoppingsul: "BSS",
};

const UF_TO_SVG_ID: Record<string, string> = {
    AC: "ac",
    AL: "al",
    AP: "ap",
    AM: "am",
    BA: "ba",
    CE: "ce",
    DF: "df",
    ES: "es",
    GO: "go",
    MA: "ma",
    MT: "mt",
    MS: "ms",
    MG: "mg",
    PA: "pa",
    PB: "pb",
    PR: "pr",
    PE: "pe",
    PI: "pi",
    RJ: "rj",
    RN: "rn",
    RS: "rs",
    RO: "ro",
    RR: "rr",
    SC: "sc",
    SP: "sp",
    SE: "se",
    TO: "to",
};

function formatUnitCount(count: number) {
    const label = count === 1 ? "unidade" : "unidades";
    return `+${count} ${label}`;
}

function Pin({
    x,
    y,
    active,
    onEnter,
    onLeave,
    onToggle,
    onToggleKeyboard,
    setRef,
}: {
    x: number;
    y: number;
    active: boolean;
    onEnter: () => void;
    onLeave: () => void;
    onToggle: () => void;
    onToggleKeyboard?: () => void;
    setRef?: (el: SVGGElement | null) => void;
}) {
    // Balloon marker similar to the provided reference (simplified, original SVG).
    const w = 86;
    const h = 112;
    const cls = active ? "brPin brPin--active" : "brPin";

    return (
        <g
            ref={setRef}
            transform={`translate(${x} ${y})`}
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
            onClick={onToggle}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    (onToggleKeyboard ?? onToggle)();
                }
            }}
            style={{ cursor: "pointer" }}
            role="button"
            aria-label="Ver unidades"
            aria-pressed={active}
            tabIndex={0}
        >
            <g transform={`translate(${-w / 2} ${-h})`}>
                <g className={cls}>
                    <path
                        d="M43 0C19.3 0 0 19.3 0 43c0 27.6 28.4 52.1 37.9 60.1 3 2.5 7.3 2.5 10.3 0C57.6 95.1 86 70.6 86 43 86 19.3 66.7 0 43 0z"
                        fill={active ? "rgba(17,17,17,0.92)" : "rgba(255,255,255,0.92)"}
                        stroke={active ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.20)"}
                        strokeWidth="2"
                        style={{ transition: "fill 160ms ease, stroke 160ms ease" }}
                    />
                    <circle cx="43" cy="40" r="24" fill={active ? "#ffffff" : "#111111"} style={{ transition: "fill 160ms ease" }} />

                    {(() => {
                        const targetWidth = 24;
                        const scale = targetWidth / 484;
                        const targetHeight = 432 * scale;
                        const left = 43 - targetWidth / 2;
                        const top = 40 - targetHeight / 2;
                        const fill = active ? "#111111" : "#ffffff";

                        return (
                            <g transform={`translate(${left} ${top}) scale(${scale})`} fill={fill} aria-hidden="true">
                                <rect x="0" y="0" width="484" height="62" />
                                <rect x="0" y="184" width="484" height="63" />
                                <rect x="0" y="184" width="63" height="248" />
                                <rect x="196" y="370" width="288" height="62" />
                            </g>
                        );
                    })()}
                </g>
            </g>
        </g>
    );
}

export default function UnitsMapSection() {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const statePathRefs = useRef<Record<string, SVGPathElement | null>>({});

    const [openState, setOpenState] = useState<TooltipState>(null);
    const [hoverUf, setHoverUf] = useState<string | null>(null);
    const hoverClearTimerRef = useRef<number | null>(null);
    const tooltipHoverRef = useRef(false);
    const openByKeyboardRef = useRef(false);
    const pinRefs = useRef<Record<string, SVGGElement | null>>({});
    const tooltipItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

    const [pointsByUf, setPointsByUf] = useState<Record<string, ProjectedPoint>>({});

    function setHoverUfDebounced(next: string | null) {
        if (hoverClearTimerRef.current) {
            window.clearTimeout(hoverClearTimerRef.current);
            hoverClearTimerRef.current = null;
        }
        setHoverUf(next);
    }

    function clearHoverUfSoon() {
        if (hoverClearTimerRef.current) {
            window.clearTimeout(hoverClearTimerRef.current);
        }
        hoverClearTimerRef.current = window.setTimeout(() => {
            hoverClearTimerRef.current = null;
            setHoverUf(null);
        }, 140);
    }

    useEffect(() => {
        return () => {
            if (hoverClearTimerRef.current) {
                window.clearTimeout(hoverClearTimerRef.current);
                hoverClearTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!openState) return;
        const uf = openState.uf;

        function onKeyDown(e: KeyboardEvent) {
            if (e.key !== "Escape") return;
            e.preventDefault();
            setOpenState(null);
            pinRefs.current[uf]?.focus();
        }

        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [openState]);

    useEffect(() => {
        if (!openState) return;
        if (!openByKeyboardRef.current) return;
        openByKeyboardRef.current = false;

        const t = window.setTimeout(() => {
            tooltipItemRefs.current[0]?.focus();
        }, 0);

        return () => window.clearTimeout(t);
    }, [openState]);

    const stateGroups = useMemo(() => {
        const map = new Map<string, (typeof units)[number][]>();
        for (const u of units) {
            if (!u.state) continue;
            const arr = map.get(u.state) ?? [];
            arr.push(u);
            map.set(u.state, arr);
        }

        const groups = Array.from(map.entries())
            .map(([uf, list]) => ({
                uf,
                units: list,
                point: computeStatePoint(list),
            }))
            .sort((a, b) => a.uf.localeCompare(b.uf));

        return groups;
    }, []);

    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;
        if (stateGroups.length === 0) return;

        const minDist = 78;
        const iterations = 50;
        const spring = 0.035;

        function getStatePathForUf(uf: string) {
            const id = UF_TO_SVG_ID[uf] ?? uf.toLowerCase();
            return statePathRefs.current[id] ?? null;
        }

        function isInsideState(uf: string, x: number, y: number) {
            const path = getStatePathForUf(uf);
            if (!path) return true;
            const anyPath = path as unknown as { isPointInFill?: (p: DOMPointInit) => boolean };
            if (typeof anyPath.isPointInFill !== "function") return true;
            return Boolean(anyPath.isPointInFill(new DOMPoint(x, y)));
        }

        function findStateAnchor(uf: string): ProjectedPoint | null {
            const path = getStatePathForUf(uf);
            if (!path) return null;

            const bbox = path.getBBox();
            const center = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
            if (isInsideState(uf, center.x, center.y)) return center;

            const maxR = Math.max(bbox.width, bbox.height) / 2;
            const step = Math.max(6, Math.min(bbox.width, bbox.height) / 10);
            for (let r = step; r <= maxR; r += step) {
                for (let angle = 0; angle < 360; angle += 30) {
                    const rad = (angle * Math.PI) / 180;
                    const x = center.x + Math.cos(rad) * r;
                    const y = center.y + Math.sin(rad) * r;
                    if (isInsideState(uf, x, y)) return { x, y };
                }
            }

            return center;
        }

        function clampToState(uf: string, x: number, y: number, anchor: ProjectedPoint): ProjectedPoint {
            if (isInsideState(uf, x, y)) return { x, y };

            let lo = 0;
            let hi = 1;
            for (let i = 0; i < 14; i++) {
                const mid = (lo + hi) / 2;
                const px = x + (anchor.x - x) * mid;
                const py = y + (anchor.y - y) * mid;
                if (isInsideState(uf, px, py)) hi = mid;
                else lo = mid;
            }
            const fx = x + (anchor.x - x) * hi;
            const fy = y + (anchor.y - y) * hi;
            if (isInsideState(uf, fx, fy)) return { x: fx, y: fy };

            return anchor;
        }

        const nodes = stateGroups.map((g) => {
            const preferred = g.point;
            const anchor = findStateAnchor(g.uf) ?? preferred;
            const start = isInsideState(g.uf, preferred.x, preferred.y) ? preferred : anchor;
            return {
                uf: g.uf,
                x: start.x,
                y: start.y,
                x0: preferred.x,
                y0: preferred.y,
                anchor,
            };
        });

        for (let iter = 0; iter < iterations; iter++) {
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const a = nodes[i];
                    const b = nodes[j];
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const dist = Math.hypot(dx, dy) || 0.0001;
                    if (dist >= minDist) continue;
                    const push = (minDist - dist) / 2;
                    const ux = dx / dist;
                    const uy = dy / dist;
                    a.x -= ux * push;
                    a.y -= uy * push;
                    b.x += ux * push;
                    b.y += uy * push;
                }
            }

            for (const n of nodes) {
                n.x += (n.x0 - n.x) * spring;
                n.y += (n.y0 - n.y) * spring;
                const clamped = clampToState(n.uf, n.x, n.y, n.anchor);
                n.x = clamped.x;
                n.y = clamped.y;
            }
        }

        const next: Record<string, ProjectedPoint> = {};
        for (const n of nodes) next[n.uf] = { x: n.x, y: n.y };
        setPointsByUf(next);
    }, [stateGroups]);

    function openTooltipAt(uf: string, x: number, y: number) {
        tooltipItemRefs.current = [];
        const wrap = wrapRef.current;
        const svg = svgRef.current;
        if (!wrap || !svg) return;

        const wrapRect = wrap.getBoundingClientRect();
        const svgRect = svg.getBoundingClientRect();

        const nx = (x - BRAZIL_VIEWBOX.minX) / BRAZIL_VIEWBOX.width;
        const ny = (y - BRAZIL_VIEWBOX.minY) / BRAZIL_VIEWBOX.height;

        const px = nx * svgRect.width + (svgRect.left - wrapRect.left);
        const py = ny * svgRect.height + (svgRect.top - wrapRect.top);

        const side: "left" | "right" = px < wrapRect.width * 0.58 ? "right" : "left";
        setOpenState({ uf, left: px, top: py, side });
    }

    const activeGroup = openState ? stateGroups.find((g) => g.uf === openState.uf) ?? null : null;
    const activeTitle = activeGroup ? STATE_NAME_BY_UF[activeGroup.uf] ?? activeGroup.uf : "";
    const activeCount = activeGroup ? formatUnitCount(activeGroup.units.length) : "";
    const featuredUnits = useMemo(
        () =>
            FEATURED_UNIT_SLUGS.map((slug) => units.find((u) => u.slug === slug)).filter(
                (u): u is (typeof units)[number] => Boolean(u),
            ),
        [],
    );

    return (
        <div className="unitsMapLayout">
            <div className="unitsMapSplit">
                <div className="unitsMapLeft">
                    <div className="brMap" aria-label="Mapa do Brasil com unidades" ref={wrapRef}>
                        <svg ref={svgRef} viewBox={brazilMap.viewBox} role="group" aria-label="Mapa do Brasil interativo">
                            <g fill="#111111" opacity="0.85">
                                {brazilMap.locations.map((loc: { id: string; path: string }) => (
                                    <path
                                        key={loc.id}
                                        d={loc.path}
                                        ref={(el) => {
                                            statePathRefs.current[loc.id] = el;
                                        }}
                                    />
                                ))}
                            </g>

                            {stateGroups.map((g) => {
                                const p = pointsByUf[g.uf] ?? g.point;
                                const isPinActive = g.uf === hoverUf || g.uf === openState?.uf;
                                return (
                                    <Pin
                                        key={g.uf}
                                        x={p.x}
                                        y={p.y}
                                        active={isPinActive}
                                        onEnter={() => openTooltipAt(g.uf, p.x, p.y)}
                                        onLeave={() => {
                                            // close shortly after leaving the pin (unless the tooltip is hovered)
                                            window.setTimeout(() => {
                                                if (tooltipHoverRef.current) return;
                                                setOpenState((s) => (s && s.uf === g.uf ? null : s));
                                            }, 80);
                                        }}
                                        onToggle={() => {
                                            if (openState?.uf === g.uf) {
                                                setOpenState(null);
                                                return;
                                            }

                                            openTooltipAt(g.uf, p.x, p.y);
                                        }}
                                        onToggleKeyboard={() => {
                                            openByKeyboardRef.current = true;
                                            if (openState?.uf === g.uf) {
                                                setOpenState(null);
                                                return;
                                            }
                                            openTooltipAt(g.uf, p.x, p.y);
                                        }}
                                        setRef={(el) => {
                                            pinRefs.current[g.uf] = el;
                                        }}
                                    />
                                );
                            })}
                        </svg>

                        <div className="brMapHint">
                            Passe o mouse ou use Tab/Enter no balão para ver as unidades do estado.
                        </div>

                        {openState && activeGroup ? (
                            <div
                                className={`brTooltip brTooltip--${openState.side}`}
                                style={{ left: openState.left, top: openState.top }}
                                onMouseEnter={() => {
                                    tooltipHoverRef.current = true;
                                }}
                                onMouseLeave={() => {
                                    tooltipHoverRef.current = false;
                                    setOpenState(null);
                                }}
                                onFocusCapture={() => {
                                    tooltipHoverRef.current = true;
                                }}
                                onBlurCapture={(e) => {
                                    const next = e.relatedTarget as Node | null;
                                    if (next && e.currentTarget.contains(next)) return;
                                    tooltipHoverRef.current = false;
                                    setOpenState(null);
                                }}
                            >
                                <div className="brTooltipTitleRow">
                                    <div className="brTooltipTitleMain">{activeTitle}</div>
                                    <div className="brTooltipTitleSub">{activeCount}</div>
                                </div>
                                <div className="brTooltipList">
                                    {activeGroup.units
                                        .slice()
                                        .sort((a, b) => a.name.localeCompare(b.name))
                                        .map((u, idx) => (
                                            <button
                                                key={u.slug}
                                                className="brTooltipItem"
                                                ref={(el) => {
                                                    tooltipItemRefs.current[idx] = el;
                                                }}
                                                onClick={() => {
                                                    const dest = getUnitDestination(u);
                                                    trackEvent("unit_map_click", { unitSlug: u.slug, placement: "state_tooltip", destination: dest });
                                                    window.location.assign(dest);
                                                }}
                                            >
                                                {u.name}
                                            </button>
                                        ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="unitsMapRight" aria-label="Lista de unidades por estado">
                    <div className="unitsStatesPanel">
                        {featuredUnits.length ? (
                            <div className="unitsFeatured" aria-label="Nossas unidades">
                                <div className="unitsFeaturedTitle">Nossas unidades</div>
                                <div className="unitsFeaturedList">
                                    {featuredUnits.map((u) => (
                                        <button
                                            key={u.slug}
                                            className="unitsFeaturedItem"
                                            onMouseEnter={() => {
                                                if (!u.state) return;
                                                setHoverUfDebounced(u.state);
                                            }}
                                            onMouseLeave={() => clearHoverUfSoon()}
                                            onFocus={() => {
                                                if (!u.state) return;
                                                setHoverUfDebounced(u.state);
                                            }}
                                            onBlur={() => clearHoverUfSoon()}
                                            onClick={() => {
                                                const dest = getUnitDestination(u);
                                                trackEvent("unit_map_click", { unitSlug: u.slug, placement: "featured_list", destination: dest });
                                                window.location.assign(dest);
                                            }}
                                        >
                                            <span className="unitsFeaturedItemTag">{FEATURED_UNIT_TAGS[u.slug as (typeof FEATURED_UNIT_SLUGS)[number]]}</span>
                                            <span className="unitsFeaturedItemName">{u.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        <div className="unitsStatesTitle">Unidades por estado</div>
                        <div className="unitsStatesList">
                            {stateGroups.map((g) => (
                                <div key={g.uf} className="unitsStateBlock">
                                    <div
                                        className="unitsStateHeader"
                                        onMouseEnter={() => setHoverUfDebounced(g.uf)}
                                        onMouseLeave={() => clearHoverUfSoon()}
                                    >
                                        <span className="unitsStateHeaderMain">{STATE_NAME_BY_UF[g.uf] ?? g.uf}</span>
                                        <span className="unitsStateHeaderSub">{formatUnitCount(g.units.length)}</span>
                                    </div>
                                    <div className="unitsStateUnits">
                                        {g.units
                                            .slice()
                                            .sort((a, b) => a.name.localeCompare(b.name))
                                            .map((u) => (
                                                <button
                                                    key={u.slug}
                                                    className="unitsStateUnit"
                                                    onMouseEnter={() => setHoverUfDebounced(g.uf)}
                                                    onMouseLeave={() => clearHoverUfSoon()}
                                                    onClick={() => {
                                                        const dest = getUnitDestination(u);
                                                        trackEvent("unit_map_click", { unitSlug: u.slug, placement: "state_list", destination: dest });
                                                        window.location.assign(dest);
                                                    }}
                                                >
                                                    {u.name}
                                                </button>
                                            ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
