import { useEffect, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api');

interface ChatItem {
    id: string; name: string; unreadCount: number; isGroup: boolean; pinned: boolean; archived: boolean;
}

export function ChatsList({ token, activeChat, onSelect }: { token: string | null; activeChat: string | null; onSelect: (id: string) => void }) {
    const [chats, setChats] = useState<ChatItem[]>([]);

    useEffect(() => {
        fetch(`${API_BASE}/chats`).then(r => r.json()).then(setChats).catch(() => { });
        const int = setInterval(() => {
            fetch(`${API_BASE}/chats`).then(r => r.json()).then(setChats).catch(() => { });
        }, 10000);
        return () => clearInterval(int);
    }, [token]);

    return (
        <div style={{ overflowY: 'auto', flex: 1, background: '#f0f2f5' }}>
            {chats.map(c => (
                <div key={c.id} onClick={() => onSelect(c.id)} style={{ padding: '8px 10px', cursor: 'pointer', background: activeChat === c.id ? '#e7f3ff' : 'transparent', borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name || c.id}</div>
                    <div style={{ fontSize: 11, color: '#666' }}>
                        {c.isGroup && '👥'} {c.pinned && '📌'} {c.archived && '🗃️'} {c.unreadCount > 0 && <strong>({c.unreadCount})</strong>}
                    </div>
                </div>
            ))}
            {!chats.length && <div style={{ padding: 12, fontSize: 12, color: '#777' }}>Sem chats.</div>}
        </div>
    );
}
