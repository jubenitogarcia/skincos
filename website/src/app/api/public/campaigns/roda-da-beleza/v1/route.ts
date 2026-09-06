import { NextResponse } from "next/server";
import {
    RODA_DA_BELEZA_PUBLIC_CONTRACT_VERSION,
    readRodaDaBelezaPublicCampaignV1,
    rodaDaBelezaCampaignUnavailableV1,
} from "@/lib/publicCampaigns/rodaDaBelezaV1";

export const dynamic = "force-dynamic";

const ALLOWED_METHODS = "GET, HEAD, OPTIONS";

function applyPrivateNoStoreHeaders(response: NextResponse): NextResponse {
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
}

function unavailableResponse(): NextResponse {
    return applyPrivateNoStoreHeaders(
        NextResponse.json(rodaDaBelezaCampaignUnavailableV1(), { status: 503 }),
    );
}

function availableResponse(): NextResponse | null {
    const campaign = readRodaDaBelezaPublicCampaignV1();
    if (!campaign) return null;
    return applyPrivateNoStoreHeaders(
        NextResponse.json({
            ok: true,
            contractVersion: RODA_DA_BELEZA_PUBLIC_CONTRACT_VERSION,
            campaign,
        }),
    );
}

function methodNotAllowedResponse(): NextResponse {
    const response = applyPrivateNoStoreHeaders(new NextResponse(null, { status: 405 }));
    response.headers.set("Allow", ALLOWED_METHODS);
    return response;
}

function optionsResponse(): NextResponse {
    const response = applyPrivateNoStoreHeaders(new NextResponse(null, { status: 204 }));
    response.headers.set("Allow", ALLOWED_METHODS);
    return response;
}

export function GET(_request: Request): NextResponse {
    void _request;
    return availableResponse() ?? unavailableResponse();
}

export function HEAD(_request: Request): NextResponse {
    void _request;
    const response = availableResponse() ?? unavailableResponse();
    return new NextResponse(null, { status: response.status, headers: response.headers });
}

export function OPTIONS(_request: Request): NextResponse {
    void _request;
    return optionsResponse();
}

export function POST(_request: Request): NextResponse {
    void _request;
    return methodNotAllowedResponse();
}

export function PUT(_request: Request): NextResponse {
    void _request;
    return methodNotAllowedResponse();
}

export function PATCH(_request: Request): NextResponse {
    void _request;
    return methodNotAllowedResponse();
}

export function DELETE(_request: Request): NextResponse {
    void _request;
    return methodNotAllowedResponse();
}
