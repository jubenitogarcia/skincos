const REDIRECTS: Record<string, string> = {
    "/nh": "https://espacofacial.com/novohamburgo",
    "/novohamburgo": "https://espacofacial.com/novohamburgo",
    "/bss": "https://espacofacial.com/barrashoppingsul",
    "/barrashoppingsul": "https://espacofacial.com/barrashoppingsul",
    "/nh/faleconosco": "https://espacofacial.com/novohamburgo/faleconosco",
    "/bss/faleconosco": "https://espacofacial.com/barrashoppingsul/faleconosco",
};

function normalizePathname(pathname: string): string {
    // Remove trailing slashes except for root.
    const trimmed = pathname.replace(/\/+$/, "");
    return trimmed.length ? trimmed : "/";
}

function redirect(to: string, status = 301): Response {
    return new Response(null, {
        status,
        headers: {
            location: to,
            "cache-control": "public, max-age=300",
        },
    });
}

export default {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // Normalize www -> apex for esfa.co
        const host = request.headers.get("host") ?? url.host;
        if (host.startsWith("www.")) {
            const apex = host.replace(/^www\./, "");
            const target = new URL(url.toString());
            target.host = apex;
            return redirect(target.toString(), 308);
        }

        const pathname = normalizePathname(url.pathname);
        const dest = REDIRECTS[pathname];

        if (dest) {
            // Preserve query string when redirecting to the main site.
            if (url.search) {
                const out = new URL(dest);
                out.search = url.search;
                return redirect(out.toString(), 301);
            }
            return redirect(dest, 301);
        }

        if (pathname === "/" || pathname === "/index.html") {
            return redirect("https://espacofacial.com/", 301);
        }

        return new Response("Not Found", { status: 404 });
    },
};
