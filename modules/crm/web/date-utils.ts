export function parseDate(input: string | number | Date): Date {
    if (input instanceof Date) return input
    return new Date(input)
}

export function toISODateString(date: Date): string {
    return date.toISOString()
}
