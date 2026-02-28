'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays } from 'date-fns';

export default function DashboardPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any | null>(null);
  const [trend, setTrend] = useState<any[]>([]);

  useEffect(() => {
    setLoading(true);
    api
      .listCampaigns()
      .then((data) => setCampaigns(data as any[]))
      .catch(() => setCampaigns([]))
      .finally(() => setLoading(false));

    const since = format(subDays(new Date(), 6), 'yyyy-MM-dd');
    const until = format(new Date(), 'yyyy-MM-dd');
    api
      .summary({ since, until })
      .then((data) => setSummary(data))
      .catch(() => setSummary(null));
    api
      .trend({ since, until })
      .then((data) => setTrend(data as any[]))
      .catch(() => setTrend([]));
  }, []);

  const spend = summary?.spend ?? 0;
  const activeCampaigns = summary?.activeCampaigns ?? campaigns.filter((c) => c.status === 'ACTIVE').length;
  const roas = summary?.roas ? `${summary.roas.toFixed(2)}x` : '—';
  const cpa = summary?.clicks ? `R$ ${(spend / summary.clicks).toFixed(2)}` : '—';
  const chartData = trend.length ? trend : [];

  return (
    <div className="space-y-8">
      <section className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-semibold">Dashboard</h2>
          <p className="text-slate-400 mt-2">Visão geral de gastos e performance.</p>
        </div>
        <button className="rounded-full bg-cyan-400/20 px-5 py-2 text-sm font-semibold text-cyan-200">
          Atualizar dados
        </button>
      </section>

      <section className="grid grid-cols-4 gap-4">
        {[
          { label: 'Spend', value: spend.toFixed(2), suffix: 'USD' },
          { label: 'Campanhas ativas', value: activeCampaigns },
          { label: 'ROAS', value: roas },
          { label: 'CPA médio', value: cpa },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-xs uppercase text-slate-400">{card.label}</p>
            <p className="mt-3 text-2xl font-semibold">
              {card.value} {card.suffix ?? ''}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Tendência de gasto (últimos 7 dias)</h3>
          <p className="text-slate-400 text-sm">Baseado em insights diários.</p>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="day" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Line type="monotone" dataKey="spend" stroke="#22d3ee" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h3 className="text-lg font-semibold">Campanhas recentes</h3>
        <p className="text-sm text-slate-400 mt-1">{loading ? 'Carregando...' : `${campaigns.length} campanhas`}</p>
        <div className="mt-4 grid gap-3">
          {campaigns.slice(0, 5).map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-xl bg-slate-950/60 p-4">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-slate-400">{c.objective ?? '—'}</p>
              </div>
              <span className="text-xs uppercase text-slate-400">{c.status}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
