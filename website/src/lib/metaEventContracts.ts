export const META_SCHEDULE_CONTENT_TYPE = "booking";

export function buildMetaScheduleCustomData(): {
    content_type: typeof META_SCHEDULE_CONTENT_TYPE;
    currency: "BRL";
} {
    return {
        content_type: META_SCHEDULE_CONTENT_TYPE,
        currency: "BRL",
    };
}
