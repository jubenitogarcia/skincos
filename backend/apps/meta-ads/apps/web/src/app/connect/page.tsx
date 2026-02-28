'use client';

import { useState } from 'react';
import { api } from '../../lib/api';
import { setToken } from '../../lib/auth';

export default function ConnectPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [message, setMessage] = useState('');
  const [accounts, setAccounts] = useState<any[]>([]);

  async function handleRegister() {
    const res: any = await api.register({ email, password, orgName: orgName || 'Minha Org' });
    setToken(res.token);
    setMessage('Registrado com sucesso');
  }

  async function handleLogin() {
    const res: any = await api.login({ email, password });
    setToken(res.token);
    setMessage('Login OK');
  }

  async function handleOAuth() {
    const res: any = await api.oauthUrl();
    window.open(res.url, '_blank');
  }

  async function handleLoadAccounts() {
    const data: any = await api.listAdAccounts();
    setAccounts(data);
  }

  async function handleSelectAccount(id: string) {
    await api.selectAdAccount({ adAccountId: id });
    setMessage('Conta selecionada');
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-semibold">Conectar Meta</h2>
        <p className="text-slate-400 mt-2">Faça login local e conecte a sua conta Meta.</p>
      </div>

      <section className="grid grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h3 className="font-semibold">Login / Registro</h3>
          <div className="mt-4 space-y-3">
            <input
              className="w-full rounded-lg bg-slate-950/80 px-3 py-2 text-sm"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="w-full rounded-lg bg-slate-950/80 px-3 py-2 text-sm"
              placeholder="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              className="w-full rounded-lg bg-slate-950/80 px-3 py-2 text-sm"
              placeholder="Org (para registro)"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="rounded-lg bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-200"
                onClick={handleRegister}
              >
                Registrar
              </button>
              <button
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold"
                onClick={handleLogin}
              >
                Login
              </button>
            </div>
            {message ? <p className="text-xs text-emerald-300">{message}</p> : null}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h3 className="font-semibold">OAuth Meta</h3>
          <p className="text-sm text-slate-400 mt-2">
            Gere a URL de autorização e finalize o fluxo no Meta Business.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              className="rounded-lg bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-200"
              onClick={handleOAuth}
            >
              Abrir OAuth
            </button>
            <button
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold"
              onClick={handleLoadAccounts}
            >
              Listar contas
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h3 className="font-semibold">Ad Accounts</h3>
        <div className="mt-4 grid gap-3">
          {accounts.map((acc) => (
            <div key={acc.id} className="flex items-center justify-between rounded-xl bg-slate-950/60 p-4">
              <div>
                <p className="font-medium">{acc.name}</p>
                <p className="text-xs text-slate-400">{acc.metaAccountId ?? acc.id}</p>
              </div>
              <button
                className="rounded-lg bg-cyan-500/20 px-3 py-2 text-xs font-semibold text-cyan-200"
                onClick={() => handleSelectAccount(acc.id)}
              >
                Selecionar
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
