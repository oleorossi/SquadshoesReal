import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useOnlineStatus } from '@/lib/mobile/networkStatus';
import { countPendingOrders } from '@/lib/mobile/offlineQueue';
import { installAutoSync, triggerSync } from '@/lib/mobile/syncEngine';
import { House, Plus, ClockClockwise, User } from '@phosphor-icons/react';

/**
 * Layout mobile-first: sem sidebar do desktop, status bar topo, bottom
 * tab nav iOS-style. Usado por todas as rotas /m/*.
 *
 * Estrutura visual:
 *   ┌────────────────────────┐
 *   │ ⚡ Online · 0 pendentes │  ← status bar (8mm)
 *   ├────────────────────────┤
 *   │                        │
 *   │   <Outlet />           │  ← conteúdo principal
 *   │                        │
 *   ├────────────────────────┤
 *   │  🏠   ➕   ⏱   👤      │  ← bottom tab (60pt iOS)
 *   └────────────────────────┘
 */
export default function MobileLayout() {
  const online = useOnlineStatus();
  const location = useLocation();
  const [pendingCount, setPendingCount] = useState(0);

  // Boot: instala auto-sync + conta pendentes
  useEffect(() => {
    const cleanup = installAutoSync();
    const refresh = async () => setPendingCount(await countPendingOrders());
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, []);

  const tabs = [
    { to: '/m', icon: House, label: 'Início' },
    { to: '/m/new', icon: Plus, label: 'Novo PV' },
    { to: '/m/pending', icon: ClockClockwise, label: 'Pendentes' },
    { to: '/m/profile', icon: User, label: 'Perfil' },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground" style={{
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-card text-[11px] font-mono uppercase tracking-widest">
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {online ? 'Online' : 'Offline'}
        </span>
        {pendingCount > 0 && (
          <button
            onClick={() => void triggerSync().then(async () => setPendingCount(await countPendingOrders()))}
            className="text-amber-600 font-bold"
          >
            {pendingCount} pendente{pendingCount > 1 ? 's' : ''} · sync
          </button>
        )}
      </div>

      {/* Conteúdo principal */}
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      {/* Bottom tab nav (iOS-style) */}
      <nav className="fixed bottom-0 inset-x-0 bg-card border-t border-border flex justify-around items-stretch z-50" style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        height: 'calc(60px + env(safe-area-inset-bottom))',
      }}>
        {tabs.map(t => {
          const Icon = t.icon;
          const active = location.pathname === t.to || (t.to !== '/m' && location.pathname.startsWith(t.to));
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 ${active ? 'text-primary' : 'text-muted-foreground'}`}
            >
              <Icon className="h-6 w-6" weight={active ? 'fill' : 'regular'} />
              <span className="text-[10px] font-medium uppercase tracking-wide">{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
