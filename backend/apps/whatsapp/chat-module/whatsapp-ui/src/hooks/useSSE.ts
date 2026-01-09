import { useEffect, useRef, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api');

interface Status {
    ready: boolean;
    qr?: string;
}

interface EventEnvelope {
    type: string;
    data?: any;
}

export function useSSE(token: string | null) {
    const [events, setEvents] = useState<EventEnvelope[]>([]);
    const [status, setStatus] = useState<Status | null>(null);
    const esRef = useRef<EventSource | null>(null);

    useEffect(() => {
        const url = `${API_BASE}/events`;
        const es = new EventSource(url, { withCredentials: false });
        esRef.current = es;
        es.onmessage = (msg) => {
            try {
                const parsed: EventEnvelope = JSON.parse(msg.data);
                setEvents(prev => [...prev.slice(-500), parsed]);
                if (parsed.type === 'qr') setStatus(s => ({ ...(s || { ready: false }), qr: parsed.data.qr }));
                if (parsed.type === 'ready') setStatus(s => ({ ...(s || {}), ready: true, qr: undefined }));
                if (parsed.type === 'disconnected') setStatus(s => ({ ...(s || {}), ready: false }));
            } catch (_) { }
        };
        return () => { es.close(); };
    }, [token]);

    useEffect(() => {
        // poll status occasionally
        let stop = false;
        async function poll() {
            while (!stop) {
                try {
                    const r = await fetch(`${API_BASE}/status`);
                    if (r.ok) {
                        const js = await r.json();
                        setStatus(s => ({ ...(s || {}), ready: js.ready, qr: js.qr }));
                    }
                } catch (_) { }
                await new Promise(r => setTimeout(r, 5000));
            }
        }
        poll();
        return () => { stop = true; };
    }, []);

    return { events, status };
}
