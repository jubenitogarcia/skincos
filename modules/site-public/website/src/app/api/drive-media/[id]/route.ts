import { driveFetchFileMedia } from "@/lib/googleDrive";

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const upstream = await driveFetchFileMedia(id, req.headers.get("range"));

    const headers = new Headers();
    const passthrough = [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "etag",
        "last-modified",
    ];

    for (const name of passthrough) {
        const v = upstream.headers.get(name);
        if (v) headers.set(name, v);
    }

    // Google Drive may omit `accept-ranges` even when it supports Range.
    // Setting it improves compatibility for HTML5 video players.
    headers.set("accept-ranges", "bytes");

    headers.set("cache-control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800");

    return new Response(upstream.body, {
        status: upstream.status,
        headers,
    });
}
