import { useState } from 'react';
import { useSSE } from './hooks/useSSE';
import { ChatsList } from './components/ChatsList';
import { MessagesPane } from './components/MessagesPane';
import { Composer } from './components/Composer';
import { Login } from './components/Login';
import { QRPanel } from './components/QRPanel';
import { useAuth } from './hooks/useAuth';

export default function App() {
    const { token, login, logout, authEnabled } = useAuth();
    const { events, status } = useSSE(token);
    const [activeChat, setActiveChat] = useState<string | null>(null);

    if (authEnabled && !token) {
        return <Login onLogin={login} />;
    }

    const ready = status?.ready;
    const qr = status?.qr;

    return (
        <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
            <div style={{ width: 320, borderRight: '1px solid #ddd', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px', borderBottom: '1px solid #ddd', fontWeight: 600 }}>WhatsApp Chats</div>
                <ChatsList token={token} activeChat={activeChat} onSelect={setActiveChat} />
                <div style={{ marginTop: 'auto', padding: 8, fontSize: 12, color: '#555' }}>
                    {ready ? '✅ Conectado' : '⌛ Aguardando QR'}<br />
                    {authEnabled && <button onClick={logout}>Sair</button>}
                </div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {!ready && qr && <QRPanel qr={qr} />}
                {ready && activeChat && <MessagesPane chatId={activeChat} token={token} events={events} />}
                {ready && activeChat && <Composer chatId={activeChat} token={token} />}
                {!activeChat && ready && (
                    <div style={{ padding: 24, color: '#666' }}>Selecione um chat.</div>
                )}
            </div>
        </div>
    );
}
