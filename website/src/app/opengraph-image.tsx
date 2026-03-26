import { headers } from "next/headers";

export const runtime = "nodejs";

export const contentType = "image/svg+xml";

export default async function OpenGraphImage() {
    const host = ((await headers()).get("host") ?? "").replace(/:\d+$/, "");
    const isSkincos = host === "skincos.com.br" || host === "www.skincos.com.br";
    const title = isSkincos ? "ORB by SKINCOS" : "Espaço Facial";
    const subtitle = isSkincos
        ? "Integrações, automações e estrutura institucional para Meta"
        : "Harmonização facial e corporal";
    const domain = isSkincos ? "skincos.com.br" : "espacofacial.com";
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${isSkincos ? "#0b1a26" : "#111"}"/>
            <stop offset="55%" stop-color="${isSkincos ? "#163047" : "#2a2a2a"}"/>
            <stop offset="100%" stop-color="${isSkincos ? "#244d6b" : "#111"}"/>
        </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <text x="64" y="290" fill="#fff" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="${isSkincos ? "60" : "64"}" font-weight="800">${title}</text>
    <text x="64" y="350" fill="rgba(255,255,255,0.88)" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="28">${subtitle}</text>
    <text x="64" y="410" fill="rgba(255,255,255,0.68)" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="18">${domain}</text>
</svg>`;

    return new Response(svg, {
        headers: {
            "content-type": contentType,
            "cache-control": "public, max-age=86400",
        },
    });
}
