import { useEffect, useRef, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api');

interface Message {
    id: string; from: string; to: string; body: string; timestamp: number; fromMe: boolean; hasMedia?: boolean; type: string;
}

export function MessagesPane({ chatId, token, events }: { chatId: string; token: string | null; events: any[] }) {
    const [messages, setMessages] = useState<Message[]>([]);
    const bottomRef = useRef<HTMLDivElement | null>(null);

    async function loadInitial() {
        try {
            const r = await fetch(`${API_BASE}/messages?chatId=${encodeURIComponent(chatId)}&limit=200`);
            const js = await r.json();
            setMessages(js.items || []);
        } catch (_) { }
    }

    useEffect(() => { loadInitial(); }, [chatId]);

    useEffect(() => {
        // integrate new incoming messages from SSE
        const incoming = events.filter(e => e.type === 'message' && (e.data?.from === chatId || e.data?.to === chatId));
        if (!incoming.length) return;
        setMessages(prev => {
            const ids = new Set(prev.map(m => m.id));
            const appended = [...prev];
            for (const ev of incoming) {
                if (!ids.has(ev.data.id)) appended.push(ev.data);
            }
            return appended.slice(-1000);
        });
    }, [events, chatId]);

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    return (
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, background: '#efeae2' }}>
            {messages.map(m => (
                <div key={m.id} style={{ display: 'flex', justifyContent: m.fromMe ? 'flex-end' : 'flex-start', margin: '4px 0' }}>
                    <div style={{ background: m.fromMe ? '#d1f4cc' : '#fff', padding: '6px 8px', borderRadius: 6, maxWidth: '70%', fontSize: 14 }}>
                        {m.body || <i style={{ color: '#999' }}>({m.type})</i>}
                        {m.hasMedia && <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>(mídia)</div>}
                        <div style={{ fontSize: 10, color: '#777', textAlign: 'right', marginTop: 4 }}>{new Date(m.timestamp).toLocaleTimeString()}</div>
                    </div>
                </div>
            ))}
            <div ref={bottomRef} />
        </div>
    );
}
