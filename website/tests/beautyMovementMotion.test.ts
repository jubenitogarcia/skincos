import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BEAUTY_MOVEMENT_MOTION, createBeautyMovementMotionGate } from "../src/lib/beautyMovementMotion";

test("beauty movement motion keeps its visible stages and reading windows aligned", () => {
    assert.equal(BEAUTY_MOVEMENT_MOTION.autoAdvanceMs, 5_000);
    assert.equal(BEAUTY_MOVEMENT_MOTION.finaleHoldMs, 5_000);
    assert.equal(BEAUTY_MOVEMENT_MOTION.handRevealMs, 1_500);
    assert.equal(BEAUTY_MOVEMENT_MOTION.handDealMs, 960);
    assert.ok(BEAUTY_MOVEMENT_MOTION.handDealSettleMs > 0);
    assert.equal(BEAUTY_MOVEMENT_MOTION.handCollectMs, 860);
    assert.equal(BEAUTY_MOVEMENT_MOTION.handExpandMs, 760);
    assert.equal(
        BEAUTY_MOVEMENT_MOTION.progressCollapseMs +
            BEAUTY_MOVEMENT_MOTION.progressTransferMs +
            BEAUTY_MOVEMENT_MOTION.progressExpandMs,
        BEAUTY_MOVEMENT_MOTION.progressTransitionMs,
    );
    assert.equal(BEAUTY_MOVEMENT_MOTION.finaleCardsEnterMs, 880);
    assert.equal(
        BEAUTY_MOVEMENT_MOTION.finaleCardMergeMs + BEAUTY_MOVEMENT_MOTION.finaleMergeStaggerMs * 2,
        BEAUTY_MOVEMENT_MOTION.finaleMergeMs,
    );
    assert.ok(BEAUTY_MOVEMENT_MOTION.finaleMergeSettleMs > 0);
    assert.ok(BEAUTY_MOVEMENT_MOTION.handRevealFallbackMs > BEAUTY_MOVEMENT_MOTION.handRevealMs);
});

test("beauty movement motion gates discard stale timer callbacks after a newer action", () => {
    const gate = createBeautyMovementMotionGate();
    const revealToken = gate.start();

    assert.equal(gate.isCurrent(revealToken), true);

    gate.invalidate();
    assert.equal(gate.isCurrent(revealToken), false);

    const manualAdvanceToken = gate.start();
    assert.equal(gate.isCurrent(manualAdvanceToken), true);
    assert.equal(gate.isCurrent(revealToken), false);
});

test("the initial hand expands the table before dealing cards", async () => {
    const experience = await readFile(
        new URL("../src/components/BeautyMovementExperience.tsx", import.meta.url),
        "utf8",
    );
    const normalDeal = experience.slice(experience.indexOf("setTableExpansionHeight(null)"));
    const expandIndex = normalDeal.indexOf('setCurrentHandStage("expand")');
    const measureIndex = normalDeal.indexOf("const targetHeight =");
    const dealIndex = normalDeal.indexOf('setCurrentHandStage("deal")');
    const dealSettleIndex = normalDeal.indexOf(
        "BEAUTY_MOVEMENT_MOTION.handDealMs + BEAUTY_MOVEMENT_MOTION.handDealSettleMs",
    );

    assert.ok(expandIndex >= 0);
    assert.ok(measureIndex > expandIndex);
    assert.ok(dealIndex > measureIndex);
    assert.ok(dealSettleIndex > dealIndex);
});
