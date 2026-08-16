import { useQuery } from '@tanstack/react-query';
import {
  Cube as Box,
  Stack as Layers,
  Package as PackageCheck,
  WarningCircle as AlertCircle,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface PackagingDecisionProps {
  order: {
    orderId: string;
    reference: string;
    quantity: number;
  };
}

interface PlanRow {
  packaging_mode: string;
  packaging_type: string | null;
  box_type_id: string | null;
  box_name: string | null;
  unit_label: string | null;
  pairs_per_package: number | null;
  required_quantity: number | null;
  actual_debited: number | null;
  remaining_quantity: number | null;
  available_quantity: number | null;
  audit_status: string;
  sole_group_name: string | null;
}

interface BoxMeta {
  id: string;
  comprimento_cm: number | null;
  largura_cm: number | null;
  altura_cm: number | null;
  unit_price: number | null;
}

const MODE_LABEL: Record<string, string> = {
  individual_master: 'Tradicional (Individual + Master)',
  colmeia: 'Caixa Colmeia',
  individual_fitilho: 'Amarrado (Individual + Fitilho)',
  individual_amarrado: 'Amarrado (legado)',
};

const STATUS_LABEL: Record<string, string> = {
  ok: 'Débito conferido',
  sem_debito: 'Ainda não debitado',
  parcial: 'Débito parcial',
  sem_estoque: 'Sem estoque',
  estoque_parcial: 'Estoque insuficiente',
  sem_solado: 'Ficha sem solado',
  sem_caixa: 'Solado sem caixa',
  caixa_inativa: 'Caixa inativa',
  nao_aplicavel: 'Não aplicável',
};

const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function PackagingDecision({ order }: PackagingDecisionProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['packaging_plan_for_order', order.orderId],
    enabled: !!order.orderId,
    queryFn: async () => {
      const { data: planData, error: planError } = await (supabase as any).rpc('plan_packaging_for_order', {
        p_order_id: order.orderId,
      });
      if (planError) throw planError;
      const plan = (planData ?? []) as PlanRow[];
      const ids = [...new Set(plan.map(row => row.box_type_id).filter(Boolean))] as string[];
      if (ids.length === 0) return { plan, boxes: new Map<string, BoxMeta>() };

      const { data: boxData, error: boxError } = await supabase
        .from('box_types')
        .select('id, comprimento_cm, largura_cm, altura_cm, unit_price')
        .in('id', ids);
      if (boxError) throw boxError;
      return {
        plan,
        boxes: new Map((boxData ?? []).map(box => [box.id, box as BoxMeta])),
      };
    },
    staleTime: 30_000,
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const plan = data?.plan ?? [];
  const mode = plan[0]?.packaging_mode ?? '';
  const sole = plan[0]?.sole_group_name ?? null;
  const breakdown = plan.map(row => {
    const box = row.box_type_id ? data?.boxes.get(row.box_type_id) : null;
    const required = Number(row.required_quantity ?? 0);
    const unitPrice = Number(box?.unit_price ?? 0);
    const volumeM3 = row.packaging_type === 'fitilho'
      ? 0
      : Number(box?.comprimento_cm ?? 0) * Number(box?.largura_cm ?? 0) * Number(box?.altura_cm ?? 0) / 1_000_000;
    return {
      ...row,
      cost: required * unitPrice,
      volume: required * volumeM3,
      hasIssue: !['ok', 'nao_aplicavel'].includes(row.audit_status),
    };
  });

  const totalCost = breakdown.reduce((sum, row) => sum + row.cost, 0);
  const totalVolume = breakdown.reduce((sum, row) => sum + row.volume, 0);
  const hasIssue = breakdown.some(row => row.hasIssue);

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <Box className="h-5 w-5 text-primary" />
        <CardTitle className="text-base">Plano — OP #{order.reference}</CardTitle>
        {mode && <Badge variant="outline" className="ml-auto text-xs">{MODE_LABEL[mode] ?? mode}</Badge>}
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Não foi possível calcular o plano: {(error as Error).message}
          </div>
        ) : plan.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum plano encontrado para esta OP.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Tipo de solado: <strong className="text-foreground">{sole ?? 'não vinculado'}</strong></span>
              <span>·</span>
              <span>{nf.format(order.quantity)} pares</span>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="p-2.5 font-medium">Embalagem</th>
                    <th className="p-2.5 text-center font-medium">Capacidade</th>
                    <th className="p-2.5 text-right font-medium">Necessário</th>
                    <th className="p-2.5 text-right font-medium">Debitado</th>
                    <th className="p-2.5 text-right font-medium">Estoque</th>
                    <th className="p-2.5 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {breakdown.map((row, index) => (
                    <tr key={`${row.packaging_type ?? 'none'}:${index}`} className={row.hasIssue ? 'bg-warning/[0.04]' : ''}>
                      <td className="p-2.5">
                        <div className="flex items-center gap-2">
                          <PackageCheck className="h-4 w-4 shrink-0 text-primary" />
                          <div>
                            <p className="text-xs font-medium">{row.box_name ?? 'Não configurada'}</p>
                            <p className="text-xs text-muted-foreground">{row.packaging_type ?? '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-2.5 text-center font-mono text-xs">
                        {row.pairs_per_package ? `${row.pairs_per_package} pares` : '—'}
                      </td>
                      <td className="p-2.5 text-right font-mono text-xs">
                        {row.required_quantity == null ? '—' : `${nf.format(row.required_quantity)} ${row.unit_label ?? ''}`}
                      </td>
                      <td className="p-2.5 text-right font-mono text-xs">{nf.format(row.actual_debited ?? 0)}</td>
                      <td className="p-2.5 text-right font-mono text-xs">
                        {row.available_quantity == null ? '—' : nf.format(row.available_quantity)}
                      </td>
                      <td className="p-2.5">
                        <Badge variant="outline" className={row.hasIssue
                          ? 'border-warning/30 bg-warning/10 text-warning-foreground'
                          : 'border-success/30 bg-success/10 text-success'}>
                          {STATUS_LABEL[row.audit_status] ?? row.audit_status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Cubicagem calculada</p>
                <p className="mt-0.5 flex items-center gap-1.5 font-mono text-sm font-bold">
                  <Layers className="h-4 w-4 text-primary" /> {totalVolume.toFixed(3)} m³
                </p>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Custo previsto</p>
                <p className="mt-0.5 text-sm font-bold">{totalCost > 0 ? brl.format(totalCost) : '—'}</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Origem da configuração</p>
                <p className="mt-0.5 text-sm font-bold">Tipo de solado</p>
              </div>
            </div>

            {hasIssue && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                Corrija a pendência nas abas Configuração por Solado ou Cadastro & Estoque deste módulo.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
