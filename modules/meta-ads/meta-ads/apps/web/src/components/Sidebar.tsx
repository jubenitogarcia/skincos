'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const items = [
  { href: '/', label: 'Dashboard' },
  { href: '/connect', label: 'Conectar Meta' },
  { href: '/campaigns', label: 'Campanhas' },
  { href: '/bulk', label: 'Bulk Operations' },
  { href: '/alerts', label: 'Alerts' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="border-r border-slate-800 bg-slate-950/60 p-6">
      <div className="mb-10">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Meta Control Center</p>
        <h1 className="text-2xl font-semibold mt-2">Painel</h1>
      </div>
      <nav className="flex flex-col gap-2">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              'rounded-xl px-4 py-3 text-sm font-medium transition',
              pathname === item.href
                ? 'bg-slate-800 text-white'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-10 rounded-xl border border-slate-800 p-4 text-xs text-slate-400">
        <p className="font-semibold text-slate-200">Modo MVP</p>
        <p className="mt-2">Dados mockáveis e conexão real via Meta SDK.</p>
      </div>
    </aside>
  );
}
