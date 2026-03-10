function normalizePhoneToDigits(phone: string): string {
    // Accept: "+55...", "55...", "tel:+55...", "(51) 9...." etc.
    const cleaned = phone.replace(/^tel:/i, "").trim();
    return cleaned.replace(/\D/g, "");
}

export function buildWhatsAppUrl(phone: string, message: string): string | null {
    const digits = normalizePhoneToDigits(phone);
    if (!digits) return null;

    const text = message.trim();
    const q = text ? `?text=${encodeURIComponent(text)}` : "";
    return `https://wa.me/${digits}${q}`;
}
