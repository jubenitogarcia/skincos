import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSiteCustomUrlInput } from "../src/lib/siteCustomUrls";

test("normalizeSiteCustomUrlInput creates a safe campaign URL record", () => {
    const input = normalizeSiteCustomUrlInput({
        name: "Botox Novo Hamburgo",
        slugPath: "campanhas/botox-nh",
        destinationUrl: "https://espacofacial.com/agendamento?unit=novo-hamburgo&service=botox",
        utmSource: "meta",
        utmMedium: "paid_social",
        utmCampaign: "botox_novo_hamburgo",
        utmContent: "video_01",
        unitSlug: "novo-hamburgo",
        serviceId: "botox",
    });

    assert.equal(input.siteHost, "espacofacial.com");
    assert.equal(input.slugPath, "/campanhas/botox-nh");
    assert.equal(input.destinationHost, "espacofacial.com");
    assert.equal(input.destinationUrl, "https://espacofacial.com/agendamento?unit=novo-hamburgo&service=botox&utm_source=meta&utm_medium=paid_social&utm_campaign=botox_novo_hamburgo&utm_content=video_01");
    assert.equal(input.utmCampaign, "botox_novo_hamburgo");
    assert.equal(input.unitSlug, "novo-hamburgo");
});

test("normalizeSiteCustomUrlInput rejects unsafe destinations and API slugs", () => {
    assert.throws(
        () => normalizeSiteCustomUrlInput({
            name: "Destino inseguro",
            destinationUrl: "http://evil.example/path",
        }),
        /destination_url_must_be_https/,
    );

    assert.equal(
        normalizeSiteCustomUrlInput({
            name: "Slug API",
            slugPath: "/api/private",
            destinationUrl: "https://espacofacial.com/agendamento",
        }).slugPath,
        "/campanhas/slug-api",
    );
});
