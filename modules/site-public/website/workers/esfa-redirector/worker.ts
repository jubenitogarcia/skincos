import { ESFA_PRESERVE_QUERYSTRING, ESFA_REDIRECTS, normalizeEsfaRedirectPath } from '../../src/lib/esfaRedirects';

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = unknown>() => Promise<T | null>;
};

type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatement;
};

type WorkerEnv = {
  BOOKING_DB?: D1DatabaseLike;
};

type RedirectRow = {
  destination_url: string;
};

async function readManagedRedirect(env: WorkerEnv, slugPath: string): Promise<string | null> {
  const db = env.BOOKING_DB;
  if (!db) return null;
  try {
    const row = await db
      .prepare(
        `SELECT destination_url
         FROM site_custom_urls
         WHERE active = 1
           AND site_host = ?
           AND slug_path = ?
         LIMIT 1`,
      )
      .bind('esfa.co', slugPath)
      .first<RedirectRow>();
    return row?.destination_url ?? null;
  } catch {
    return null;
  }
}

export function resolveEsfaRedirectTarget(targetBase: string, incomingSearch: string): string {
  const target = new URL(targetBase);
  if (!ESFA_PRESERVE_QUERYSTRING || !incomingSearch) return target.toString();

  const targetParams = new URLSearchParams(target.search);
  const incomingParams = new URLSearchParams(incomingSearch);
  const incomingKeys = new Set(Array.from(incomingParams.keys()));
  for (const key of incomingKeys) targetParams.delete(key);
  for (const [key, value] of incomingParams) targetParams.append(key, value);
  const merged = targetParams.toString();
  target.search = merged ? `?${merged}` : "";
  return target.toString();
}

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = normalizeEsfaRedirectPath(url.pathname);

    const targetBase = (await readManagedRedirect(env, path)) || ESFA_REDIRECTS[path];
    if (!targetBase) return new Response("Not Found", { status: 404 });

    return Response.redirect(resolveEsfaRedirectTarget(targetBase, url.search), 301);
  },
};

export default worker;
