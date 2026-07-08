import test from "node:test";
import assert from "node:assert/strict";
import { buildUnitSelectionHref } from "@/lib/unitSelection";

test("buildUnitSelectionHref rewrites booking page to the selected unit and clears stale booking state", () => {
    const href = buildUnitSelectionHref({
        pathname: "/agendamento",
        searchParams: new URLSearchParams("unit=novohamburgo&doctor=dra-samara-silva&service=botox&autopick=first&booking=abc&statusToken=secret"),
        nextUnitSlug: "barrashoppingsul",
    });

    assert.equal(href, "/agendamento?unit=barrashoppingsul#booking-flow");
});

test("buildUnitSelectionHref preserves unrelated booking query params", () => {
    const href = buildUnitSelectionHref({
        pathname: "/agendamento",
        searchParams: new URLSearchParams("unit=novohamburgo&utm_source=instagram"),
        nextUnitSlug: "barrashoppingsul",
    });

    assert.equal(href, "/agendamento?unit=barrashoppingsul&utm_source=instagram#booking-flow");
});

test("buildUnitSelectionHref does not force redirects outside the booking page", () => {
    const href = buildUnitSelectionHref({
        pathname: "/sobre",
        searchParams: new URLSearchParams("unit=novohamburgo"),
        nextUnitSlug: "barrashoppingsul",
    });

    assert.equal(href, null);
});
