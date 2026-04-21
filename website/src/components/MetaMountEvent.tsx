"use client";

import { useEffect, useRef } from "react";
import { trackMetaStandardEvent } from "@/lib/metaBrowser";

type MetaMountEventProps = {
    eventName: string;
    params?: Record<string, unknown>;
    dedupeKey: string;
};

export default function MetaMountEvent({ eventName, params, dedupeKey }: MetaMountEventProps) {
    const firedRef = useRef(false);

    useEffect(() => {
        if (firedRef.current) return;
        trackMetaStandardEvent(eventName, params, { dedupeKey });
        firedRef.current = true;
    }, [dedupeKey, eventName, params]);

    return null;
}
