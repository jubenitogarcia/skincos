'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = () =>
    api
      .alerts()
      .then((data) => setAlerts(data as any[]))
      .catch(() => setAlerts([]));

  useEffect(() => {
    load();
  }, []);

  async function resolve(id: string) {
    await api.resolveAlert(id);
    load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-semibold">Alerts</h2>
        <p className="text-slate-400 mt-2">Pacing e anomalias de gasto.</p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div key={alert.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{alert.type}</p>
                  <p className="text-xs text-slate-400">{alert.message}</p>
                </div>
                <button
                  className="rounded-lg bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-200"
                  onClick={() => resolve(alert.id)}
                >
                  Resolver
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
