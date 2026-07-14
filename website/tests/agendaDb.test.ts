import assert from "node:assert/strict";
import test from "node:test";
import { parseDateKey, parseTimeKey } from "../src/lib/agendaDb";
import { personNameMatches } from "../src/lib/escalaDb";
import { doctorSlugMatchesQuery } from "../src/lib/doctorSlug";
import { doctors as marketingDoctors } from "../src/data/doctors";

test("parseDateKey returns yyyy-mm-dd", () => {
    assert.equal(parseDateKey("03/03/2026"), "2026-03-03");
    assert.equal(parseDateKey("31/12/2026"), "2026-12-31");
});

test("parseDateKey rejects invalid", () => {
    assert.equal(parseDateKey("2026-03-03"), "");
    assert.equal(parseDateKey("03/03/26"), "");
});

test("parseTimeKey returns hh:mm", () => {
    assert.equal(parseTimeKey("09:00"), "09:00");
    assert.equal(parseTimeKey("18:30"), "18:30");
});

test("parseTimeKey rejects invalid", () => {
    assert.equal(parseTimeKey("9:00"), "");
    assert.equal(parseTimeKey("25:00"), "");
});

test("personNameMatches accepts honorific and middle-name variations", () => {
    assert.equal(personNameMatches("Dra. Josiele de Souza", "Josiele Maiara de Souza"), true);
    assert.equal(personNameMatches("Josiele de Souza", "Josiele Maiara de Souza"), true);
});

test("personNameMatches rejects different professionals", () => {
    assert.equal(personNameMatches("Viviane Mondin", "Josiele Maiara de Souza"), false);
});

test("doctorSlugMatchesQuery accepts public doctor aliases", () => {
    assert.equal(
        doctorSlugMatchesQuery("drajosielesouza", {
            name: "Josiele de Souza",
            instagramHandle: "dra.josiele",
        }),
        true,
    );
});

test("doctorSlugMatchesQuery covers all public doctor slugs by name alias", () => {
    for (const doctor of marketingDoctors) {
        assert.equal(
            doctorSlugMatchesQuery(doctor.slug, {
                name: doctor.name,
                instagramHandle: null,
            }),
            true,
            `expected alias for ${doctor.slug}`,
        );
    }
});
