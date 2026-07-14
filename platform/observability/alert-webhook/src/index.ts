interface Env {
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_TOKEN: string;
  WEBHOOK_TOKEN: string;
}

type IncomingPayload = {
  text?: string;
  subject?: string;
  message?: string;
  source?: string;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function normalizeMessage(payload: IncomingPayload, fallbackText: string): string {
  const pieces = [payload.subject, payload.message, payload.text]
    .map((value) => (value || "").trim())
    .filter((value) => value.length > 0);

  if (pieces.length === 0) {
    return fallbackText;
  }

  // Keep the message compact and deterministic for issue body generation.
  return pieces.join("\n\n");
}

async function createGithubIssue(env: Env, title: string, body: string): Promise<Response> {
  const apiUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`;
  return fetch(apiUrl, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "accept": "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "skincos-obs-alert-webhook",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      title,
      body,
    }),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "method_not_allowed" });
    }

    const incomingToken = request.headers.get("x-obs-token") || "";
    if (!env.WEBHOOK_TOKEN || incomingToken !== env.WEBHOOK_TOKEN) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    let payload: IncomingPayload = {};
    let rawBody = "";
    try {
      rawBody = await request.text();
      payload = rawBody ? (JSON.parse(rawBody) as IncomingPayload) : {};
    } catch {
      payload = {};
    }

    const now = new Date().toISOString();
    const source = payload.source?.trim() || request.headers.get("x-alert-source") || "uptime-slo";
    const message = normalizeMessage(payload, rawBody || "alert without payload body");

    const title = `[SLO][FAIL] ${source} - ${now}`;
    const body = [
      "Alerta automático recebido pelo webhook de observabilidade.",
      "",
      `- Source: ${source}`,
      `- Time (UTC): ${now}`,
      "",
      "```text",
      message,
      "```",
    ].join("\n");

    const issueRes = await createGithubIssue(env, title, body);
    if (!issueRes.ok) {
      const errorText = await issueRes.text();
      return jsonResponse(502, {
        error: "github_issue_create_failed",
        status: issueRes.status,
        details: errorText.slice(0, 500),
      });
    }

    const issue = (await issueRes.json()) as { html_url?: string; number?: number };
    return jsonResponse(202, {
      ok: true,
      issue_url: issue.html_url || null,
      issue_number: issue.number || null,
    });
  },
};
