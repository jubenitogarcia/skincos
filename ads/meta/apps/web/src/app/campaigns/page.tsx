'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { api } from '../../lib/api';

export default function CampaignsPage() {
  const [data, setData] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<any | null>(null);
  const [actionType, setActionType] = useState<'pause' | 'resume' | 'budget' | 'rename' | 'duplicate'>('pause');
  const [budgetMode, setBudgetMode] = useState<'absolute' | 'percent'>('absolute');
  const [budgetValue, setBudgetValue] = useState(0);
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [deepCopy, setDeepCopy] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
    objective: true,
    dailyBudget: true,
    status: true,
  });

  useEffect(() => {
    api
      .listCampaigns()
      .then((rows) => setData(rows as any[]))
      .catch(() => setData([]));
  }, []);

  const columns = useMemo<ColumnDef<any>[]>(
    () => [
      {
        id: 'select',
        header: '',
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={!!selected[row.original.metaId || row.original.id]}
            onChange={(e) => {
              const id = row.original.metaId || row.original.id;
              setSelected((prev) => ({ ...prev, [id]: e.target.checked }));
            }}
          />
        ),
      },
      {
        accessorKey: 'name',
        header: 'Nome',
        cell: ({ row }) => {
          const value = row.original.name as string;
          return (
            <input
              className="w-full rounded-md bg-slate-950/40 px-2 py-1 text-sm"
              value={value}
              onChange={(e) => {
                const next = e.target.value;
                const targetId = row.original.metaId || row.original.id;
                setData((prev) =>
                  prev.map((item) =>
                    (item.metaId || item.id) === targetId ? { ...item, name: next } : item,
                  ),
                );
              }}
            />
          );
        },
      },
      { accessorKey: 'status', header: 'Status' },
      { accessorKey: 'objective', header: 'Objetivo' },
      { accessorKey: 'dailyBudget', header: 'Budget diário' },
    ],
    [selected],
  );

  const filteredData = data.filter((row) => {
    const matchesName = nameFilter ? row.name?.toLowerCase().includes(nameFilter.toLowerCase()) : true;
    const matchesStatus = statusFilter === 'all' ? true : row.status === statusFilter;
    return matchesName && matchesStatus;
  });

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });

  const selectedIds = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([id]) => id);

  async function handlePreview() {
    const payload =
      actionType === 'budget'
        ? { mode: budgetMode, value: budgetValue }
        : actionType === 'rename'
          ? { prefix, suffix }
          : actionType === 'duplicate'
            ? { prefix, suffix, deepCopy }
          : undefined;
    const res = await api.bulkPreview({
      entityType: 'campaign',
      actionType,
      ids: selectedIds,
      payload,
    });
    setPreview(res);
  }

  async function handleExecute() {
    const payload =
      actionType === 'budget'
        ? { mode: budgetMode, value: budgetValue }
        : actionType === 'rename'
          ? { prefix, suffix }
          : actionType === 'duplicate'
            ? { prefix, suffix, deepCopy }
          : undefined;
    await api.bulkExecute({
      entityType: 'campaign',
      actionType,
      ids: selectedIds,
      payload,
    });
    setPreview(null);
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-semibold">Campanhas</h2>
        <p className="text-slate-400 mt-2">Selecione campanhas e execute ações em lote.</p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value as any)}
              className="rounded-lg bg-slate-950/80 px-3 py-2 text-sm"
            >
              <option value="pause">Pause</option>
              <option value="resume">Resume</option>
              <option value="budget">Ajustar budget</option>
              <option value="rename">Renomear</option>
              <option value="duplicate">Duplicar</option>
            </select>
            {actionType === 'budget' ? (
              <div className="flex items-center gap-2">
                <select
                  value={budgetMode}
                  onChange={(e) => setBudgetMode(e.target.value as any)}
                  className="rounded-lg bg-slate-950/80 px-2 py-2 text-sm"
                >
                  <option value="absolute">Valor</option>
                  <option value="percent">%</option>
                </select>
                <input
                  type="number"
                  className="w-24 rounded-lg bg-slate-950/80 px-2 py-2 text-sm"
                  value={budgetValue}
                  onChange={(e) => setBudgetValue(Number(e.target.value))}
                />
              </div>
            ) : null}
            {actionType === 'rename' ? (
              <div className="flex items-center gap-2">
                <input
                  className="w-28 rounded-lg bg-slate-950/80 px-2 py-2 text-sm"
                  placeholder="Prefixo"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                />
                <input
                  className="w-28 rounded-lg bg-slate-950/80 px-2 py-2 text-sm"
                  placeholder="Sufixo"
                  value={suffix}
                  onChange={(e) => setSuffix(e.target.value)}
                />
              </div>
            ) : null}
            {actionType === 'duplicate' ? (
              <div className="flex items-center gap-2">
                <input
                  className="w-28 rounded-lg bg-slate-950/80 px-2 py-2 text-sm"
                  placeholder="Prefixo"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                />
                <input
                  className="w-28 rounded-lg bg-slate-950/80 px-2 py-2 text-sm"
                  placeholder="Sufixo"
                  value={suffix}
                  onChange={(e) => setSuffix(e.target.value)}
                />
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={deepCopy}
                    onChange={(e) => setDeepCopy(e.target.checked)}
                  />
                  Deep copy
                </label>
              </div>
            ) : null}
            <button
              className="rounded-lg bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-200"
              onClick={handlePreview}
              disabled={selectedIds.length === 0}
            >
              Preview
            </button>
          </div>
          <span className="text-xs text-slate-400">{selectedIds.length} selecionadas</span>
        </div>

        {preview ? (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-sm">{preview.count} itens serão afetados</p>
            <div className="mt-3 space-y-2">
              {preview.previews.map((p: any) => (
                <div key={p.id} className="text-xs text-slate-300">
                  {p.id}:{' '}
                  {p.error
                    ? `Erro: ${p.error}`
                    : actionType === 'rename' || actionType === 'duplicate'
                      ? `${p.before.name} → ${p.after.name}`
                      : actionType === 'budget'
                        ? `${p.before.dailyBudget ?? '-'} → ${p.after.dailyBudget ?? '-'}`
                        : `${p.before.status} → ${p.after.status}`}
                </div>
              ))}
            </div>
            <button
              className="mt-4 rounded-lg bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-50"
              onClick={handleExecute}
              disabled={preview.previews.some((p: any) => !p.valid)}
            >
              Executar
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <input
              className="rounded-lg bg-slate-950/80 px-3 py-2 text-sm"
              placeholder="Filtrar por nome"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg bg-slate-950/80 px-3 py-2 text-sm"
            >
              <option value="all">Status (todos)</option>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
            </select>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            {table.getAllLeafColumns().map((col) =>
              col.id === 'select' || col.id === 'name' ? null : (
                <label key={col.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={col.getIsVisible()}
                    onChange={col.getToggleVisibilityHandler()}
                  />
                  {col.id}
                </label>
              ),
            )}
          </div>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-400">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className="py-3">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-800">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
