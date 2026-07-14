import assert from "node:assert/strict";
import test from "node:test";
import { classifySiteLinkClick, sanitizeSiteBehaviorMetadata } from "../src/lib/siteBehavior";

test("sanitizeSiteBehaviorMetadata keeps only safe scalar values and limits free text", () => {
    const result = sanitizeSiteBehaviorMetadata({
        placement: "home hero",
        step: "unit_selected",
        count: 2,
        accepted: true,
        nested: { patientName: "Pessoa Teste" },
        longText: "x".repeat(180),
    });

    assert.deepEqual(result, {
        placement: "home hero",
        step: "unit_selected",
        count: 2,
        accepted: true,
        longText: "x".repeat(120),
    });
});

test("classifySiteLinkClick identifies tracked whatsapp redirects", () => {
    const eventName = classifySiteLinkClick(
        "/api/whatsapp/redirect?dest=https%3A%2F%2Fwa.me%2F5551999999999",
        "espacofacial.com",
    );

    assert.equal(eventName, "whatsapp_redirect_click");
});

test("classifySiteLinkClick identifies campaign links and external links", () => {
    assert.equal(
        classifySiteLinkClick("https://espacofacial.com/agendamento?utm_source=meta&utm_campaign=botox_nh", "espacofacial.com"),
        "custom_link_click",
    );
    assert.equal(
        classifySiteLinkClick("https://app.espacofacial.com.br/login", "espacofacial.com"),
        "external_link_click",
    );
});

test("classifySiteLinkClick identifies internal booking CTAs", () => {
    assert.equal(classifySiteLinkClick("/agendamento", "espacofacial.com"), "cta_click");
    assert.equal(classifySiteLinkClick("/novohamburgo/faleconosco", "espacofacial.com"), "cta_click");
});
