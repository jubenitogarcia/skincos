import { headers } from "next/headers";

export const runtime = "nodejs";

export const contentType = "image/svg+xml";

export default async function TwitterImage() {
    const host = ((await headers()).get("host") ?? "").replace(/:\d+$/, "");
    const isSkincos = host === "skincos.com.br" || host === "www.skincos.com.br";
    const title = isSkincos ? "ORB by SKINCOS" : "Espaço Facial";
    const subtitle = isSkincos ? "Política, termos e exclusão de dados" : "Agende pela sua unidade";
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="${isSkincos ? "#0b1a26" : "#0f0f10"}"/>
    <text x="600" y="310" text-anchor="middle" fill="#fff" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="${isSkincos ? "62" : "70"}" font-weight="900">${title}</text>
    <text x="600" y="370" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="28">${subtitle}</text>
</svg>`;

    return new Response(svg, {
        headers: {
            "content-type": contentType,
            "cache-control": "public, max-age=86400",
        },
    });
}
