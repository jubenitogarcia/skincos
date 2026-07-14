import { useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api');

export function Composer({ chatId, token }: { chatId: string; token: string | null }) {
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);

    async function send(e: React.FormEvent) {
        e.preventDefault();
        if (!text.trim()) return;
        setSending(true);
        try {
            await fetch(`${API_BASE}/send`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({ to: chatId, type: 'text', text })
            });
            setText('');
        } catch (_) { /* ignore */ } finally { setSending(false); }
    }

    return (
        <form onSubmit={send} style={{ display: 'flex', gap: 8, padding: 8, borderTop: '1px solid #ddd' }}>
            <input style={{ flex: 1, padding: '6px 8px' }} value={text} onChange={e => setText(e.target.value)} placeholder="Mensagem" />
            <button disabled={sending || !text.trim()} style={{ padding: '6px 12px' }}>{sending ? '...' : 'Enviar'}</button>
        </form>
    );
}
