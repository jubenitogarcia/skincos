import crypto from "node:crypto";
const REPOSITORY = "jubenitogarcia/skincos";
const REPOSITORY_ID = 1060913632;

export const TOKEN_PROFILES = Object.freeze({
  admission: Object.freeze({ contents: "read", pull_requests: "read", statuses: "write" }),
  security: Object.freeze({ contents: "read", security_events: "write" }),
  merge: Object.freeze({ contents: "write", pull_requests: "write", statuses: "write" }),
});

function positiveId(value, label) {
  if (!/^[1-9][0-9]{0,15}$/.test(String(value))) throw new Error(`${label} is invalid`);
  return Number(value);
}

export function appJwt({ appId, privateKey, now = Date.now() }) {
  const key = crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength < 2048) {
    throw new Error("GitHub App requires an RSA private key of at least 2048 bits");
  }
  const seconds = Math.floor(now / 1000);
  const encode = (data) => Buffer.from(JSON.stringify(data)).toString("base64url");
  const message = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: seconds - 60, exp: seconds + 480, iss: positiveId(appId, "App ID") })}`;
  return `${message}.${crypto.sign("RSA-SHA256", Buffer.from(message), key).toString("base64url")}`;
}

export function assertScopedToken(body, profile, now = Date.now()) {
  const permissions = TOKEN_PROFILES[profile];
  if (!permissions) throw new Error("GitHub App token profile is invalid");
  if (typeof body?.token !== "string" || body.token.length < 24
    || !Array.isArray(body.repositories) || body.repositories.length !== 1
    || body.repositories[0]?.id !== REPOSITORY_ID || body.repositories[0]?.full_name !== REPOSITORY) {
    throw new Error("GitHub App token repository scope is invalid");
  }
  if (!body.permissions || Object.entries(permissions).some(([name, level]) => body.permissions[name] !== level)
    || Object.entries(body.permissions).some(([name, level]) => name === "metadata" ? level !== "read" : permissions[name] !== level)) {
    throw new Error("GitHub App token permission scope is invalid");
  }
  const expiry = Date.parse(body.expires_at || "");
  if (!Number.isFinite(expiry) || expiry <= now + 300_000 || expiry > now + 3_660_000) {
    throw new Error("GitHub App token lifetime is invalid");
  }
  return body.token;
}

export async function issueInstallationToken({ appId, installationId, privateKey, profile, fetchImpl = fetch, now = Date.now() }) {
  const permissions = TOKEN_PROFILES[profile];
  if (!permissions) throw new Error("GitHub App token profile is invalid");
  const id = positiveId(installationId, "Installation ID");
  const jwt = appJwt({ appId, privateKey, now });
  const response = await fetchImpl(`https://api.github.com/app/installations/${id}/access_tokens`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${jwt}`, "x-github-api-version": "2022-11-28", "content-type": "application/json" },
    body: JSON.stringify({ repository_ids: [REPOSITORY_ID], permissions }),
  });
  if (!response.ok) throw new Error(`GitHub App issuance failed with HTTP ${response.status}`);
  return assertScopedToken(await response.json(), profile, now);
}
