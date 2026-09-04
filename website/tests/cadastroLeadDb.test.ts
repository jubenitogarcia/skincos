import assert from "node:assert/strict";
import test, { mock } from "node:test";

const moduleUrl = (relativePath: string) => new URL("../src/" + relativePath + ".ts", import.meta.url).href;
let persistedPrize: number | null = null;
let updateQuery = "";

const database = {
    prepare(query: string) {
        let values: unknown[] = [];
        return {
            bind: (...nextValues: unknown[]) => {
                values = nextValues;
                return {
                    bind: (...replacementValues: unknown[]) => {
                        values = replacementValues;
                        return this;
                    },
                    first: async <T>() => {
                        if (query.includes("SELECT prize_id")) {
                            return (persistedPrize === null ? null : { prize_id: persistedPrize }) as T | null;
                        }
                        return null;
                    },
                    run: async () => {
                        if (query.includes("UPDATE cadastro_wheel_leads")) {
                            updateQuery = query;
                            if (persistedPrize === null) {
                                persistedPrize = Number(values[0]);
                                return { success: true, meta: { changes: 1 } };
                            }
                            return { success: true, meta: { changes: 0 } };
                        }
                        return { success: true, meta: { changes: 0 } };
                    },
                };
            },
            first: async <T>() => null as T | null,
            run: async () => ({ success: true, meta: { changes: 0 } }),
        };
    },
};

mock.module(moduleUrl("lib/bookingDb"), {
    namedExports: {
        getBookingDb: async () => database,
        normalizeEmail: (value: string) => value.trim().toLowerCase(),
        normalizePhone: (value: string) => value.replace(/\D/g, ""),
        nowMs: () => 1_000,
        sanitizeOneLine: (value: string) => value.trim(),
    },
});

const { assignCadastroLeadPrize } = await import("../src/lib/cadastroLeadDb");

test("lead prize claim persists only the first prize and replays it for later attempts", async () => {
    persistedPrize = null;
    updateQuery = "";

    const first = await assignCadastroLeadPrize({ id: "lead-001", prizeId: 3 });
    const second = await assignCadastroLeadPrize({ id: "lead-001", prizeId: 9 });

    assert.deepEqual(first, { prizeId: 3, replay: false });
    assert.deepEqual(second, { prizeId: 3, replay: true });
    assert.match(updateQuery, /WHERE id = \? AND prize_id IS NULL/);
});
