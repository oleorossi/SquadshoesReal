import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PurchaseGenerateBoard } from '@/components/financial/PurchaseGenerateBoard';
import {
  allocateStock,
  DEFAULT_MOTOR_SETTINGS,
  purchaseLineKey,
  suggestPurchases,
  type MotorSettings,
  type PlanDemand,
  type PurchaseSuggestion,
  type StockPool,
} from '@/lib/cabedalPlanningMotor';
import { planFromMotorSnapshot, planMotorApply } from '@/lib/cabedalMotorApply';
import { pendingByOrderProduct, subtractOpenPurchasePending } from '@/lib/purchaseCoverage';
import { persistCabedalMotorPlan } from '@/lib/cabedalMotorApplyClient';
import { toast } from 'sonner';

interface SnapshotMaterial {
  product_id: string;
  product_name: string;
  unit: string | null;
  required: number;
  unit_price: number | null;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_lead_days: number | null;
}

interface SnapshotItem {
  sale_order_id: string;
  order_number: string;
  order_type: string | null;
  billing_week: string | null;
  item_id: string;
  reference_code: string;
  color: string | null;
  pairs: number;
  assembly_capacity_per_day: number | null;
  prep_business_days: number | null;
  explicit_complex: boolean;
  materials: SnapshotMaterial[];
}

interface Snapshot {
  motor_enabled?: boolean;
  urgent_release_without_material?: boolean;
  purchase_horizon_business_days?: number;
  weekly_purchase_cap_brl?: number | null;
  buffer_business_days?: number;
  ready_before_billing_days?: number;
  items?: SnapshotItem[];
  stock?: { product_id: string; free: number }[];
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function PurchaseGeneratePanel({ mode }: { mode: 'fornecedor' | 'pedido' }) {
  const coverage = useQuery({
    queryKey: ['pv-material-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_pv_material_coverage' as never);
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as Array<{
        sale_order_id: string;
        product_id: string;
        open_pending: number;
      }>;
    },
  });
  const query = useQuery({
    queryKey: ['cabedal-motor-purchase-snapshot'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_cabedal_motor_purchase_snapshot' as never);
      if (error) throw error;
      return (data ?? {}) as Snapshot;
    },
  });

  useEffect(() => {
    if (query.data?.motor_enabled !== true) return;
    void persistCabedalMotorPlan(planFromMotorSnapshot(query.data, todayIso())).catch(() => undefined);
  }, [query.data]);

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Lendo pedidos aprovados…</p>;
  }
  if (query.isError) {
    return (
      <p className="text-sm text-destructive">
        Não foi possível montar a simulação de compras. {query.error instanceof Error ? query.error.message : ''}
      </p>
    );
  }

  const snapshot = query.data ?? {};
  const settings: MotorSettings = {
    ...DEFAULT_MOTOR_SETTINGS,
    enabled: snapshot.motor_enabled === true,
    urgentMayReleaseWithoutMaterial: snapshot.urgent_release_without_material === true,
    purchaseHorizonBusinessDays: snapshot.purchase_horizon_business_days ?? DEFAULT_MOTOR_SETTINGS.purchaseHorizonBusinessDays,
    weeklyPurchaseCapBrl: snapshot.weekly_purchase_cap_brl ?? null,
    bufferBusinessDays: snapshot.buffer_business_days ?? DEFAULT_MOTOR_SETTINGS.bufferBusinessDays,
    readyBeforeBillingDays: snapshot.ready_before_billing_days ?? DEFAULT_MOTOR_SETTINGS.readyBeforeBillingDays,
  };
  const items: PlanDemand[] = (snapshot.items ?? []).map((item) => ({
    saleOrderId: item.sale_order_id,
    orderNumber: item.order_number,
    orderType: item.order_type,
    billingWeek: item.billing_week,
    itemId: item.item_id,
    referenceCode: item.reference_code,
    color: item.color,
    pairs: Number(item.pairs) || 0,
    assemblyCapacityPerDay: item.assembly_capacity_per_day,
    prepBusinessDays: item.prep_business_days,
    explicitComplex: item.explicit_complex === true,
    cabedalReceived: false,
    closeScore: 0,
    isPinned: false,
    isFrozen: false,
    pinnedPosition: null,
    frozenPosition: null,
    protected: false,
    materials: (item.materials ?? []).map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      unit: row.unit,
      required: Number(row.required) || 0,
      unitPrice: row.unit_price,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name || 'Sem fornecedor',
      supplierLeadDays: row.supplier_lead_days,
      protectedHeld: 0,
    })),
  }));
  const stock: StockPool[] = (snapshot.stock ?? []).map((row) => ({
    productId: row.product_id,
    free: Number(row.free) || 0,
  }));
  const today = todayIso();
  const allocation = allocateStock(items, stock, settings);
  const pending = pendingByOrderProduct((coverage.data ?? []).map((row) => ({
    saleOrderId: row.sale_order_id,
    productId: row.product_id,
    pending: Number(row.open_pending) || 0,
  })));
  const lines = subtractOpenPurchasePending(
    suggestPurchases(items, allocation, settings, today),
    pending,
  );
  const plan = planMotorApply({
    enabled: settings.enabled,
    items,
    allocation,
    purchases: lines,
    settings,
    todayIso: today,
  });

  const generate = async (picked: PurchaseSuggestion[]) => {
    if (!settings.enabled) return;
    const pickedKeys = new Set(picked.map(purchaseLineKey));
    const groups = plan.purchases
      .map((group) => ({ ...group, lines: group.lines.filter((line) => pickedKeys.has(purchaseLineKey(line))) }))
      .filter((group) => group.lines.length > 0);
    const { data, error } = await supabase.rpc('create_cabedal_motor_purchase_orders' as never, {
      p_groups: groups.map((group) => ({
        supplier_id: group.supplierId,
        supplier_name: group.supplierName,
        group_key: group.groupKey,
        lines: group.lines.map((line) => ({
          product_id: line.productId,
          quantity: line.quantity,
          unit: line.unit,
          unit_price: line.unitPrice,
          sale_order_id: line.saleOrderId,
          need_date: line.needDate,
          buy_by: line.buyBy,
          urgent: line.urgent,
        })),
      })),
    } as never);
    if (error) throw error;
    const result = data as { applied?: boolean; created?: number; reason?: string } | null;
    if (!result?.applied) {
      toast.message(result?.reason || 'Motor desligado. Nenhuma OC foi gravada.');
      return;
    }
    toast.success(result.created ? `${result.created} OC gerada pelo motor.` : 'Nenhuma OC nova nesta seleção.');
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Mesma base nas duas visões. Urgente no topo, depois quem precisa comprar antes; empate fica com o cabedal complexo.
        Pedido sem semana de faturamento não ganha data inventada.
      </p>
      <PurchaseGenerateBoard
        lines={lines}
        today={today}
        motorEnabled={settings.enabled}
        mode={mode}
        onGenerate={settings.enabled ? generate : undefined}
      />
    </div>
  );
}
