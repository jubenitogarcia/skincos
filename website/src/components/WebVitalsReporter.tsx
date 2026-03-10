"use client";

import { useReportWebVitals } from "next/web-vitals";
import { trackEvent } from "@/lib/analytics";

export default function WebVitalsReporter() {
    useReportWebVitals((metric) => {
        trackEvent("web_vital", {
            id: metric.id,
            name: metric.name,
            value: metric.value,
            delta: metric.delta,
            rating: metric.rating,
            navigationType: metric.navigationType,
        });
    });

    return null;
}
