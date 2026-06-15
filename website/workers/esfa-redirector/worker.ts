import { ESFA_PRESERVE_QUERYSTRING, ESFA_REDIRECTS, normalizeEsfaRedirectPath } from '../../src/lib/esfaRedirects';

const worker = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = normalizeEsfaRedirectPath(url.pathname);

    const targetBase = ESFA_REDIRECTS[path];
    if (!targetBase) return new Response("Not Found", { status: 404 });

    const target = new URL(targetBase);
    if (ESFA_PRESERVE_QUERYSTRING && url.search) {
      const targetParams = new URLSearchParams(target.search);
      const incomingParams = new URLSearchParams(url.search);
      for (const [key, value] of incomingParams) {
        targetParams.append(key, value);
      }
      const merged = targetParams.toString();
      target.search = merged ? `?${merged}` : "";
    }

    return Response.redirect(target.toString(), 301);
  },
};

export default worker;
