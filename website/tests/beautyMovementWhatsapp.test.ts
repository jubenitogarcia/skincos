import assert from "node:assert/strict";
import test from "node:test";
import {
    BEAUTY_MOVEMENT_WHATSAPP_PHONE,
    buildBeautyMovementWhatsappDestination,
    buildBeautyMovementWhatsappHref,
    buildBeautyMovementWhatsappMessage,
} from "../src/lib/beautyMovementWhatsapp";
import { decodeWhatsappRedirectQueryValue, parseWhatsappDestination } from "../src/lib/whatsappTracking";

test("builds a personalized campaign message from the invite name, reading and prize", () => {
    const message = buildBeautyMovementWhatsappMessage({
        displayName: "Ana",
        selectedConcepts: "Presença · Potência · Renovação",
        prize: "Firmeza & Renovação — Elleva 210 mg pelo valor do Elleva 150 mg",
    });

    assert.equal(
        message,
        "Olá! Eu sou Ana. Minha sorte em Beleza em Movimento reuniu Presença · Potência · Renovação e revelou o prêmio: Firmeza & Renovação — Elleva 210 mg pelo valor do Elleva 150 mg. Vim falar com a Espaço Facial para saber como resgatar.",
    );
    assert.equal(message.includes("invite"), false);
    assert.equal(message.includes("whatsapp"), false);
});

test("uses a safe fallback when an invite has no display name", () => {
    const message = buildBeautyMovementWhatsappMessage({
        selectedConcepts: "Autocuidado · Leveza · Brilho",
        prize: "Aula-cortesia de Velocity",
    });

    assert.match(message, /^Olá! Eu sou convidado\(a\)\./);
    assert.match(message, /Aula-cortesia de Velocity/);
});

test("campaign CTA targets the configured clinic number and preserves the message", () => {
    const message = buildBeautyMovementWhatsappMessage({
        displayName: "Lia",
        selectedConcepts: "Harmonia · Sintonia · Encontro",
        prize: "Harmonia & Definição — 2 mL e receba 4 mL",
    });
    const destination = buildBeautyMovementWhatsappDestination(message);
    const parsedDestination = parseWhatsappDestination(destination);
    assert.deepEqual(parsedDestination && {
        phone: parsedDestination.phone,
        text: parsedDestination.text,
    }, {
        phone: BEAUTY_MOVEMENT_WHATSAPP_PHONE,
        text: message,
    });

    const href = buildBeautyMovementWhatsappHref({ message, placement: "result" });
    assert.ok(href);
    const redirectUrl = new URL(href!, "https://espacofacial.com");
    const protectedDestination = redirectUrl.searchParams.get("dest");
    assert.ok(protectedDestination);
    assert.equal(
        decodeWhatsappRedirectQueryValue(protectedDestination!),
        destination,
    );
});
