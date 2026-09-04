import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

test("the wheel gate lets visitors choose a unit in context before entering the lead flow", async () => {
    const experience = await readFile(sourceUrl("src/components/CadastroWheelExperience.tsx"), "utf8");
    const styles = await readFile(sourceUrl("src/components/CadastroWheelExperience.module.css"), "utf8");

    assert.match(experience, /import UnitChooser from "@\/components\/UnitChooser"/);
    assert.match(experience, /<UnitChooser placement="cadastro_gate" \/>/);
    assert.match(styles, /\.contextualUnitChooser :global\(\.unitChooserBtn\)[\s\S]*min-height: 50px/);
});

test("lead errors are announced and validation returns focus to the first invalid field", async () => {
    const experience = await readFile(sourceUrl("src/components/CadastroWheelExperience.tsx"), "utf8");

    assert.match(experience, /leadErrorNoticeRef\.current\?\.focus\(\)/);
    assert.match(experience, /role="alert"[\s\S]*aria-atomic="true"/);
    assert.match(experience, /aria-live=\{spinError \? "assertive" : "polite"\}/);
    assert.match(experience, /firstInvalidInput\?\.focus\(\)/);
    assert.match(experience, /aria-describedby=\{fullNameInvalid \? "cadastro-full-name-error" : undefined\}/);
    assert.match(experience, /aria-describedby=\{phoneInvalid \? "cadastro-phone-error" : undefined\}/);
    assert.match(experience, /aria-describedby=\{emailInvalid \? "cadastro-email-error" : undefined\}/);
});

test("reduced motion skips the wheel animation, sound cadence, and delayed CTA", async () => {
    const [experience, styles] = await Promise.all([
        readFile(sourceUrl("src/components/CadastroWheelExperience.tsx"), "utf8"),
        readFile(sourceUrl("src/components/CadastroWheelExperience.module.css"), "utf8"),
    ]);

    assert.match(experience, /if \(!prefersReducedMotion\) \{[\s\S]*void playClickSound\(\)/);
    assert.match(experience, /if \(prefersReducedMotion\) \{[\s\S]*setButtonPhase\("gone"\)[\s\S]*setCtaVisible\(true\)/);
    assert.match(experience, /await wait\(prefersReducedMotion \? 0 : READY_DEADLINE_MS\)/);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.wheelDisc[\s\S]*transition: none !important/);
});
