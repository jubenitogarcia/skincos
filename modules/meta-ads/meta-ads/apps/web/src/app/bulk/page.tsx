'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function BulkPage() {
  const [operations, setOperations] = useState<any[]>([]);

  useEffect(() => {
    let mounted = true;
    const load = () =>
      api
        .bulkOperations()
        .then((data) => mounted && setOperations(data as any[]))
        .catch(() => mounted && setOperations([]));
    load();
    const interval = setInterval(load, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-semibold">Bulk Operations</h2>
        <p className="text-slate-400 mt-2">Histórico e progresso das ações em lote.</p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="space-y-4">
          {operations.map((op) => (
            <div key={op.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{op.actionType}</p>
                  <p className="text-xs text-slate-400">{op.entityType}</p>
                </div>
                <span className="text-xs text-slate-300">{op.status}</span>
              </div>
              <div className="mt-2 text-xs text-slate-400">
                {op.processedItems}/{op.totalItems} processados
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
