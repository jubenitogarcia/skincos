import { exchangeGoogleGbpAuthorizationCode } from "@/lib/googleGbp";
import { ensurePendingGoogleGbpOAuthAuthorization, storeGoogleGbpRefreshToken } from "@/lib/gbpOAuthAuthorization";

export const dynamic = "force-dynamic";

function page(title: string, message: string, status = 200): Response {
    return new Response(
        `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${message}</p></body></html>`,
        { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
    );
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const state = (url.searchParams.get("state") ?? "").trim();
    const code = (url.searchParams.get("code") ?? "").trim();
    const error = (url.searchParams.get("error") ?? "").trim();
    if (!state || state.length > 256 || /[^a-z0-9]/i.test(state)) return page("Autorização inválida", "O estado de autorização não é válido.", 400);
    if (error) return page("Autorização não concluída", "A aprovação foi cancelada ou recusada.", 400);

    try {
        await ensurePendingGoogleGbpOAuthAuthorization(state);
        const redirectUri = new URL("/api/gbp/oauth/callback", request.url).toString();
        const refreshToken = await exchangeGoogleGbpAuthorizationCode({ code, redirectUri });
        await storeGoogleGbpRefreshToken({ state, refreshToken });
        return page("Google Business Profile autorizado", "A autorização foi concluída com segurança. Você pode voltar ao Codex.");
    } catch {
        return page("Não foi possível concluir a autorização", "Tente iniciar uma nova aprovação pelo Codex.", 400);
    }
}
