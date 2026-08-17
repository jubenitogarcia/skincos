import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

test("the active category keeps its yellow state and the countdown is armed with the choice", async () => {
    const [experience, styles] = await Promise.all([
        readFile(sourceUrl("src/components/BeautyMovementExperience.tsx"), "utf8"),
        readFile(sourceUrl("src/components/BeautyMovementExperience.module.css"), "utf8"),
    ]);

    const start = experience.slice(
        experience.indexOf("function startAutoAdvance"),
        experience.indexOf("function scheduleNextHand"),
    );
    const reveal = experience.slice(
        experience.indexOf("async function handleReveal"),
        experience.indexOf("async function handleConfirm"),
    );
    const settle = experience.slice(
        experience.indexOf("function settleReveal"),
        experience.indexOf("function handleSelectedCardAnimationEnd"),
    );

    assert.match(experience, /const autoAdvanceScheduledRef = useRef\(false\)/);
    assert.match(experience, /const autoAdvancePendingRef = useRef\(false\)/);
    assert.match(experience, /const AUTO_ADVANCE_READING_KEYS = new Set\(/);
    assert.match(experience, /"ArrowDown"[\s\S]*"ArrowUp"[\s\S]*"PageDown"[\s\S]*"PageUp"[\s\S]*"Home"[\s\S]*"End"/);
    assert.match(experience, /target\.isContentEditable[\s\S]*target\.tagName === "INPUT"/);
    assert.match(experience, /event\.defaultPrevented \|\| event\.isComposing \|\| event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey/);
    assert.match(experience, /if \(isAutoAdvanceReadingIntent\(event\)\) cancelOnReadingIntent\(\)/);
    assert.doesNotMatch(experience, /window\.addEventListener\("keydown", cancelOnReadingIntent\)/);
    assert.ok(start.indexOf("setAutoAdvanceActive(true)") < start.indexOf("window.requestAnimationFrame"));
    assert.match(start, /handStageRef\.current !== "reveal" && handStageRef\.current !== "held"/);
    assert.match(start, /autoAdvancePendingRef\.current = true/);
    assert.match(reveal, /setCurrentHandStage\("reveal"\);\s*scheduleNextHand\(actIndex\)/);
    assert.doesNotMatch(settle, /scheduleNextHand\(actIndex\)/);
    assert.match(experience, /const isAutoAdvanceVisible = isCurrent && !progressMotion && autoAdvanceActive/);

    const rhythmLayer = styles.slice(styles.indexOf("/* Ritmo Natural"));
    assert.match(
        rhythmLayer,
        /\.progressItemCurrent \.progressButton \{[\s\S]*background: var\(--bm-yellow\);[\s\S]*color: var\(--bm-ink\);/,
    );
    assert.match(rhythmLayer, /\.progressItemCurrent \.progressButton:hover \{[\s\S]*background: var\(--bm-yellow\);/);
    assert.match(rhythmLayer, /\.autoAdvance::after \{[\s\S]*background: var\(--bm-ink\);/);
});
