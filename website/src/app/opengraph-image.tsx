export const runtime = "nodejs";

export const contentType = "image/svg+xml";

export default async function OpenGraphImage() {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#111"/>
            <stop offset="55%" stop-color="#2a2a2a"/>
            <stop offset="100%" stop-color="#111"/>
        </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <text x="64" y="290" fill="#fff" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="64" font-weight="800">Espaço Facial</text>
    <text x="64" y="350" fill="rgba(255,255,255,0.88)" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="28">Harmonização facial e corporal</text>
    <text x="64" y="410" fill="rgba(255,255,255,0.68)" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="18">espacofacial.com</text>
</svg>`;

    return new Response(svg, {
        headers: {
            "content-type": contentType,
            "cache-control": "public, max-age=86400",
        },
    });
}
