export function decodeHtmlEntities(input: string): string {
    return input
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#([0-9]+);/g, (_, num: string) => String.fromCharCode(parseInt(num, 10)))
        // Decode ampersands last so `&amp;lt;` becomes `&lt;`, never active markup.
        .replace(/&amp;/g, "&");
}
