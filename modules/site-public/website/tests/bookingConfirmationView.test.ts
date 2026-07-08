import assert from "node:assert/strict";
import test from "node:test";
import { buildBookingConfirmationViewModel } from "../src/lib/bookingConfirmationView";

test("booking confirmation view model formats patient and unit data", () => {
    const model = buildBookingConfirmationViewModel(
        {
            id: "req_123",
            unitSlug: "barrashoppingsul",
            procedureName: "Bioestimulador",
            date: "2026-04-18",
            time: "14:30",
            patientName: "Maria Silva",
            patientGender: "female",
            email: "maria@cliente.com",
            whatsapp: "51999998888",
            doctorName: "Dra. Marina",
        },
        { siteUrl: "https://espacofacial.com" },
    );

    assert.equal(model.unitName, "BarraShoppingSul");
    assert.equal(model.appointmentDate, "18/04/2026");
    assert.equal(model.customerWhatsapp, "+55 (51) 99999-8888");
    assert.equal(model.ambassadorName, "Deborah Secco");
    assert.equal(model.doctorName, "Dra. Marina");
    assert.equal(model.unitInstagramLabel, "@espacofacial_barrashoppingsul");
    assert.match(model.unitWhatsappUrl, /^https:\/\/api\.whatsapp\.com\/send\?phone=5551980882293$/);
});
