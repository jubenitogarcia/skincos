import { useEffect, useState } from 'react';

const AUTH_ENABLED = (import.meta.env.VITE_AUTH_ENABLED || 'false') === 'true';
const API_BASE = (import.meta.env.VITE_API_BASE || '/api');

export function useAuth() {
    const [token, setToken] = useState<string | null>(null);
    const authEnabled = AUTH_ENABLED;

    useEffect(() => {
        const stored = localStorage.getItem('wa_token');
        if (stored) setToken(stored);
    }, []);

    function login(username: string, password: string) {
        return fetch(`${API_BASE}/auth/login`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username, password })
        }).then(async r => {
            if (!r.ok) throw new Error('login failed');
            const data = await r.json();
            if (data.token) {
                localStorage.setItem('wa_token', data.token);
                setToken(data.token);
            }
            return data;
        });
    }

    function logout() {
        localStorage.removeItem('wa_token');
        setToken(null);
    }

    return { token, login, logout, authEnabled };
}
