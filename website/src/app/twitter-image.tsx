export const runtime = "nodejs";

export const contentType = "image/svg+xml";

export default async function TwitterImage() {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#0f0f10"/>
    <text x="600" y="310" text-anchor="middle" fill="#fff" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="70" font-weight="900">Espaço Facial</text>
    <text x="600" y="370" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="28">Agende pela sua unidade</text>
</svg>`;

    return new Response(svg, {
        headers: {
            "content-type": contentType,
            "cache-control": "public, max-age=86400",
        },
    });
}
