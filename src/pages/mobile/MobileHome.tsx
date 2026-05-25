import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ClockClockwise, ChartBar } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { countPendingOrders } from '@/lib/mobile/offlineQueue';

interface QuickStats {
  pendingOffline: number;
  myOrdersToday: number;
  myOrdersMonth: number;
}

export default function MobileHome() {
  const [stats, setStats] = useState<QuickStats | null>(null);
  const [userName, setUserName] = useState<string>('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', user.id)
        .maybeSingle();
      setUserName(profile?.full_name || profile?.email || '');

      const today = new Date().toISOString().slice(0, 10);
      const firstOfMonth = new Date();
      firstOfMonth.setDate(1);
      const firstOfMonthIso = firstOfMonth.toISOString();

      const [todayRes, monthRes, pending] = await Promise.all([
        supabase
          .from('sale_orders')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', `${today}T00:00:00Z`),
        supabase
          .from('sale_orders')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', firstOfMonthIso),
        countPendingOrders(),
      ]);

      setStats({
        pendingOffline: pending,
        myOrdersToday: todayRes.count ?? 0,
        myOrdersMonth: monthRes.count ?? 0,
      });
    })();
  }, []);

  return (
    <div className="p-4 space-y-4">
      {/* Saudação */}
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
          Bem-vindo
        </p>
        <h1 className="text-2xl font-bold text-foreground">{userName || 'Vendedor'}</h1>
      </div>

      {/* CTA principal: novo PV */}
      <Link
        to="/m/new"
        className="block bg-primary text-primary-foreground rounded-lg p-6 active:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
            <Plus className="h-6 w-6" weight="bold" />
          </div>
          <div>
            <p className="text-base font-bold uppercase tracking-wide">Novo Pedido</p>
            <p className="text-xs opacity-90">Cliente · Ref · Cor · Grade</p>
          </div>
        </div>
      </Link>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border-[1.5px] border-foreground/15 rounded-lg p-4 bg-card">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">Hoje</p>
          <p className="text-3xl font-bold tabular-nums">{stats?.myOrdersToday ?? '—'}</p>
          <p className="text-xs text-muted-foreground mt-1">pedidos</p>
        </div>
        <div className="border-[1.5px] border-foreground/15 rounded-lg p-4 bg-card">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">Mês</p>
          <p className="text-3xl font-bold tabular-nums">{stats?.myOrdersMonth ?? '—'}</p>
          <p className="text-xs text-muted-foreground mt-1">pedidos</p>
        </div>
      </div>

      {/* Fila offline */}
      {stats && stats.pendingOffline > 0 && (
        <Link
          to="/m/pending"
          className="block border-[1.5px] border-amber-500 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-4"
        >
          <div className="flex items-center gap-3">
            <ClockClockwise className="h-5 w-5 text-amber-700 dark:text-amber-400" weight="bold" />
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-900 dark:text-amber-300">
                {stats.pendingOffline} pedido{stats.pendingOffline > 1 ? 's' : ''} aguardando sync
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">Tocar pra revisar</p>
            </div>
          </div>
        </Link>
      )}

      {/* Versão app */}
      <div className="pt-8 text-center">
        <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
          Squad Vendas · v{import.meta.env.VITE_APP_VERSION || 'dev'}
        </p>
      </div>
    </div>
  );
}
