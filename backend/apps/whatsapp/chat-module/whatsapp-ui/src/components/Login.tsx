import { useState } from 'react';

export function Login({ onLogin }: { onLogin: (u: string, p: string) => Promise<any> }) {
    const [u, setU] = useState('admin');
    const [p, setP] = useState('admin');
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setErr(null); setLoading(true);
        try { await onLogin(u, p); } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
    }

    return (
        <div style={{ margin: '64px auto', maxWidth: 320 }}>
            <h2 style={{ fontWeight: 600 }}>Login</h2>
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input value={u} onChange={e => setU(e.target.value)} placeholder="Usuário" />
                <input value={p} onChange={e => setP(e.target.value)} type="password" placeholder="Senha" />
                <button disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
                {err && <div style={{ color: 'red', fontSize: 12 }}>{err}</div>}
            </form>
        </div>
    );
}
