import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SignOut, DeviceMobile, Globe, Target, Monitor } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { useAccessControl } from '@/hooks/useAccessControl';

interface ProfileData {
  email?: string;
  full_name?: string;
  sales_target_monthly_brl?: number;
  sales_target_monthly_pairs?: number;
}

interface MonthStats {
  totalBrl: number;
  totalPairs: number;
}

export default function MobileProfile() {
  const navigate = useNavigate();
  const { canAccessRoute } = useAccessControl();
  const [user, setUser] = useState<ProfileData | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [stats, setStats] = useState<MonthStats | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (u) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, email, sales_target_monthly_brl, sales_target_monthly_pairs')
          .eq('id', u.id)
          .maybeSingle();
        setUser({
          email: u.email ?? undefined,
          full_name: (profile as any)?.full_name ?? undefined,
          sales_target_monthly_brl: (profile as any)?.sales_target_monthly_brl ?? undefined,
          sales_target_monthly_pairs: (profile as any)?.sales_target_monthly_pairs ?? undefined,
        });

        // F3: stats do mês (PVs criados pelo user no mês corrente)
        const firstOfMonth = new Date();
        firstOfMonth.setDate(1);
        firstOfMonth.setHours(0, 0, 0, 0);
        const { data: orders } = await supabase
          .from('sale_orders')
          .select('total')
          .gte('created_at', firstOfMonth.toISOString())
          .neq('status', 'Cancelado');
        const ordersList = orders ?? [];
        const totalBrl = ordersList.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
        // Pairs via sale_order_items
        let totalPairs = 0;
        if (ordersList.length > 0) {
          // Aproximação: somar quantity de items dos PVs do mês
          const { data: itemsRow } = await supabase
            .from('sale_order_items')
            .select('quantity, sale_order_id, sale_orders!inner(created_at)')
            .gte('sale_orders.created_at', firstOfMonth.toISOString());
          totalPairs = (itemsRow ?? []).reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0);
        }
        setStats({ totalBrl, totalPairs });
      }
    })();
    // Detecta se app está rodando como PWA standalone (instalado)
    const mql = window.matchMedia('(display-mode: standalone)');
    setIsStandalone(mql.matches || (navigator as any).standalone === true);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold">Perfil</h2>

      <div className="bg-card border-[1.5px] border-foreground/15 rounded-lg p-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Nome</p>
        <p className="text-base font-bold">{user?.full_name || '—'}</p>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono mt-2">Email</p>
        <p className="text-sm">{user?.email || '—'}</p>
      </div>

      {/* F3: Meta de vendas do mês */}
      {stats && user && (user.sales_target_monthly_brl || user.sales_target_monthly_pairs) ? (
        <div className="bg-card border-[1.5px] border-foreground/15 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-1.5">
            <Target className="h-4 w-4 text-primary" weight="bold" />
            <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
              Meta do mês
            </p>
          </div>
          {user.sales_target_monthly_brl ? (
            <ProgressRow
              label="Faturamento"
              current={stats.totalBrl}
              target={user.sales_target_monthly_brl}
              format={(v) => `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`}
            />
          ) : null}
          {user.sales_target_monthly_pairs ? (
            <ProgressRow
              label="Pares"
              current={stats.totalPairs}
              target={user.sales_target_monthly_pairs}
              format={(v) => `${v}`}
            />
          ) : null}
        </div>
      ) : stats ? (
        <div className="bg-card border-[1.5px] border-foreground/15 rounded-lg p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">
            Mês corrente
          </p>
          <p className="text-2xl font-bold tabular-nums">
            R$ {stats.totalBrl.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-muted-foreground">{stats.totalPairs} pares · sem meta cadastrada</p>
        </div>
      ) : null}

      <div className="bg-card border-[1.5px] border-foreground/15 rounded-lg p-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-2">App</p>
        <div className="flex items-center gap-2 text-sm">
          {isStandalone ? (
            <>
              <DeviceMobile className="h-4 w-4 text-emerald-600" weight="fill" />
              <span>Instalado como app</span>
            </>
          ) : (
            <>
              <Globe className="h-4 w-4 text-muted-foreground" />
              <span>Rodando no browser</span>
            </>
          )}
        </div>
        {!isStandalone && (
          <p className="text-xs text-muted-foreground mt-2">
            Pra instalar: Safari → Compartilhar → "Adicionar à Tela de Início".
          </p>
        )}
      </div>

      {canAccessRoute('/sales') && (
        <button
          type="button"
          onClick={() => navigate('/sales')}
          className="w-full min-h-11 border-[1.5px] border-foreground/20 rounded-lg py-3 font-bold uppercase tracking-wide flex items-center justify-center gap-2"
        >
          <Monitor className="h-5 w-5" />
          Abrir no ERP
        </button>
      )}

      <button
        onClick={handleLogout}
        className="w-full border-[1.5px] border-destructive text-destructive rounded-lg py-3 font-bold uppercase tracking-wide flex items-center justify-center gap-2 active:bg-destructive/10"
      >
        <SignOut className="h-5 w-5" />
        Sair
      </button>

      <div className="pt-4 text-center text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
        Squad Vendas · v{import.meta.env.VITE_APP_VERSION || 'dev'}
      </div>
    </div>
  );
}

function ProgressRow({ label, current, target, format }: {
  label: string;
  current: number;
  target: number;
  format: (v: number) => string;
}) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const color = pct >= 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-primary' : 'bg-amber-500';
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">
          <span className="font-bold">{format(current)}</span>
          <span className="text-muted-foreground"> / {format(target)}</span>
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden mt-1">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground font-mono mt-0.5 text-right">
        {pct.toFixed(0)}% atingido
      </p>
    </div>
  );
}

