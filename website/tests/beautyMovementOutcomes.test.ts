import assert from "node:assert/strict";
import test from "node:test";
import {
    BEAUTY_MOVEMENT_CARD_AFFINITIES,
    BEAUTY_MOVEMENT_OFFERS,
    BEAUTY_MOVEMENT_OUTCOME_KEYS,
    enumerateBeautyMovementCombinations,
    resolveBeautyMovementOutcome,
} from "../src/lib/beautyMovementOutcomes";
import { BEAUTY_MOVEMENT_ACTS, BEAUTY_MOVEMENT_PALETTES, getBeautyMovementDeck } from "../src/lib/beautyMovementCards";

test("every current card has an explicit affinity vector", () => {
    for (const palette of BEAUTY_MOVEMENT_PALETTES) {
        for (const card of getBeautyMovementDeck(palette)) {
            const affinity = BEAUTY_MOVEMENT_CARD_AFFINITIES[card.id];
            assert.ok(affinity, `missing affinity for ${card.id}`);
            assert.deepEqual(Object.keys(affinity).sort(), [...BEAUTY_MOVEMENT_OUTCOME_KEYS].sort());
        }
    }
});

test("resolver is deterministic, order-independent, and rejects incomplete readings", () => {
    const selections = {
        beleza: "beleza-presenca",
        movimento: "movimento-sintonia",
        celebracao: "celebracao-encontro",
    } as const;
    const first = resolveBeautyMovementOutcome({ palette: "conexao", selections });
    const second = resolveBeautyMovementOutcome({
        palette: "conexao",
        selections: { celebracao: selections.celebracao, beleza: selections.beleza, movimento: selections.movimento },
    });
    assert.equal(first.outcomeKey, second.outcomeKey);
    assert.deepEqual(first.scores, second.scores);
    assert.match(first.rationale, /Filler|Harmonia|afinidade|Empate/);
    assert.throws(
        () => resolveBeautyMovementOutcome({ palette: "conexao", selections: { beleza: selections.beleza, movimento: selections.movimento } }),
        /beauty_movement_outcome_requires_three_cards/,
    );
});

test("the generated matrix covers all current palettes and all four commercial outcomes", () => {
    const matrix = enumerateBeautyMovementCombinations();
    assert.equal(matrix.length, BEAUTY_MOVEMENT_PALETTES.length * 3 ** BEAUTY_MOVEMENT_ACTS.length);
    for (const palette of BEAUTY_MOVEMENT_PALETTES) {
        const outcomes = new Set(matrix.filter((entry) => entry.palette === palette).map((entry) => entry.outcomeKey));
        assert.deepEqual([...outcomes].sort(), [...BEAUTY_MOVEMENT_OUTCOME_KEYS].sort(), palette);
    }
    const counts = Object.fromEntries(BEAUTY_MOVEMENT_OUTCOME_KEYS.map((key) => [key, matrix.filter((entry) => entry.outcomeKey === key).length]));
    assert.ok(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 10, JSON.stringify(counts));
    assert.ok(matrix.every((entry) => entry.rationale.length > 20), "every combination needs an editorial rationale");
    const ties = matrix.filter((entry) => {
        const winner = entry.scores.find((score) => score.outcomeKey === entry.outcomeKey)!;
        return entry.scores.filter((score) => score.score === winner.score).length > 1;
    });
    assert.equal(ties.length, 1, "only the intentionally relational/luminosity tie remains");
    assert.match(ties[0]!.rationale, /Empate/);
});

test("structured offers preserve only the supplied commercial quantities and prices", () => {
    assert.equal(BEAUTY_MOVEMENT_OFFERS.elleva_upgrade.referencePrice, null);
    assert.equal(BEAUTY_MOVEMENT_OFFERS.elleva_upgrade.unlockedPrice, null);
    assert.equal(BEAUTY_MOVEMENT_OFFERS.filler_double.trigger.quantity, 2);
    assert.equal(BEAUTY_MOVEMENT_OFFERS.filler_double.benefit.quantity, 4);
    assert.deepEqual(BEAUTY_MOVEMENT_OFFERS.sculptra_classic_unlock.referencePrice, { amount: 2899, currency: "BRL" });
    assert.deepEqual(BEAUTY_MOVEMENT_OFFERS.sculptra_classic_unlock.unlockedPrice, { amount: 1699, currency: "BRL" });
    assert.deepEqual(BEAUTY_MOVEMENT_OFFERS.skinbooster_diamond_unlock.referencePrice, { amount: 2099, currency: "BRL" });
    assert.deepEqual(BEAUTY_MOVEMENT_OFFERS.skinbooster_diamond_unlock.unlockedPrice, { amount: 899, currency: "BRL" });
    for (const offer of Object.values(BEAUTY_MOVEMENT_OFFERS)) {
        assert.match(offer.commercialText, /^Sua combinação desbloqueou/);
        assert.match(offer.externalRules.join(" "), /avaliação profissional/);
    }
});
