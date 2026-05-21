const LEGACY_WHATSAPP_PHONE = "5551998493563";
const PRIMARY_WHATSAPP_PHONE = "5551995811008";

function normalizePhoneToDigits(phone: string): string {
    // Accept: "+55...", "55...", "tel:+55...", "(51) 9...." etc.
    const cleaned = phone.replace(/^tel:/i, "").trim();
    const digits = cleaned.replace(/\D/g, "");
    return digits === LEGACY_WHATSAPP_PHONE ? PRIMARY_WHATSAPP_PHONE : digits;
}

export function buildWhatsAppUrl(phone: string, message: string): string | null {
    const digits = normalizePhoneToDigits(phone);
    if (!digits) return null;

    const text = message.trim();
    const q = text ? `?text=${encodeURIComponent(text)}` : "";
    return `https://wa.me/${digits}${q}`;
}
