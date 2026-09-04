import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { NextRequest } from "next/server";

const moduleUrl = (relativePath: string) => new URL("../src/" + relativePath + ".ts", import.meta.url).href;
const LEAD_ID = "lead-atomic-claim-test";
let persistedPrize: number | null = null;
let assignmentCalls = 0;

mock.module(moduleUrl("lib/cadastroLeadDb"), {
    namedExports: {
        findCadastroLeadById: async (id: string) => {
            return id === LEAD_ID
                ? {
                      id,
                      full_name: "Teste Roda",
                      email: "teste@example.com",
                      phone: "51999999999",
                      unit_slug: "barrashoppingsul",
                      prize_id: persistedPrize,
                      created_at_ms: 0,
                      updated_at_ms: 0,
                      awarded_at_ms: null,
                  }
                : null;
        },
        assignCadastroLeadPrize: async ({ id, prizeId }: { id: string; prizeId: number }) => {
            assignmentCalls += 1;
            if (id !== LEAD_ID) return null;
            if (persistedPrize === null) {
                persistedPrize = prizeId;
                return { prizeId, replay: false };
            }
            return { prizeId: persistedPrize, replay: true };
        },
    },
});

const { POST } = await import("../src/app/api/cadastro/wheel/route");

function request() {
    return new NextRequest("https://example.com/api/cadastro/wheel", {
        method: "POST",
        headers: { cookie: "ef_cadastro_lead=" + LEAD_ID },
    });
}

test("concurrent lead spins return the same atomic prize and mark the second result as replay", async () => {
    const previousSecret = process.env.CADASTRO_WHEEL_SECRET;
    process.env.CADASTRO_WHEEL_SECRET = "cadastro-wheel-atomic-test-secret";
    persistedPrize = null;
    assignmentCalls = 0;

    try {
        const [firstResponse, secondResponse] = await Promise.all([POST(request()), POST(request())]);
        const first = (await firstResponse.json()) as { ok: boolean; prizeId: number; replay: boolean };
        const second = (await secondResponse.json()) as { ok: boolean; prizeId: number; replay: boolean };

        assert.equal(first.ok, true);
        assert.equal(second.ok, true);
        assert.equal(assignmentCalls >= 1, true);
        assert.equal(first.prizeId, second.prizeId);
        assert.deepEqual([first.replay, second.replay].sort(), [false, true]);
    } finally {
        if (previousSecret === undefined) delete process.env.CADASTRO_WHEEL_SECRET;
        else process.env.CADASTRO_WHEEL_SECRET = previousSecret;
    }
});

test("missing lead fails closed instead of issuing an unpersisted wheel prize", async () => {
    const previousSecret = process.env.CADASTRO_WHEEL_SECRET;
    process.env.CADASTRO_WHEEL_SECRET = "cadastro-wheel-atomic-test-secret";

    try {
        const response = await POST(
            new NextRequest("https://example.com/api/cadastro/wheel", {
                method: "POST",
                headers: { cookie: "ef_cadastro_lead=missing-lead" },
            }),
        );
        assert.deepEqual(await response.json(), { ok: false, error: "lead_unavailable" });
        assert.match(response.headers.get("set-cookie") ?? "", /ef_cadastro_lead=;/);
    } finally {
        if (previousSecret === undefined) delete process.env.CADASTRO_WHEEL_SECRET;
        else process.env.CADASTRO_WHEEL_SECRET = previousSecret;
    }
});
