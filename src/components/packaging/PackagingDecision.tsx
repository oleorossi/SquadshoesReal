import { Cube as Box, Stack as Layers, Package as PackageCheck, WarningCircle as AlertCircle, Package } from '@phosphor-icons/react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** packaging modes → which packaging_type rows are consumed */
const MODE_TYPES: Record<string, string[]> = {
  colmeia:            ['colmeia'],
  individual_master:  ['individual', 'master'],
  individual_fitilho: ['individual', 'fitilho'],
  individual_amarrado:['individual'],
};

interface PackagingDecisionProps {
  order: {
    reference: string;
    quantity: number;
    /** e.g. 'individual_amarrado' | 'individual_master' | 'colmeia' */
    packagingMode?: string;
    /** Technical sheet ID — used to look up packaging_configs */
    sheetId?: string;
    /** @deprecated use packagingMode */
    model_packaging_type?: string;
    accepts_bundled_packaging?: boolean;
  };
}

export function PackagingDecision({ order }: PackagingDecisionProps) {
  const qty = Number(order.quantity) || 0;
  const mode = order.packagingMode || order.model_packaging_type || 'individual_amarrado';
  const activeTypes = MODE_TYPES[mode] || ['individual'];

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['packaging_configs_decision', order.sheetId],
    enabled: !!order.sheetId,
    queryFn: async () => {
      // Resolve solado da ficha técnica
      const { data: sheet, error: e1 } = await supabase
        .from('technical_sheets')
        .select('sole_group_id')
        .eq('id', order.sheetId!)
        .maybeSingle();
      if (e1) throw e1;
      const soleGroupId = (sheet as any)?.sole_group_id;
      if (!soleGroupId) return [];

      const { data: pg, error: e2 } = await (supabase as any)
        .from('product_groups')
        .select('box_type_id, box_type_master_id, box_type_colmeia_id, box_type_fitilho_id, pairs_per_box_individual, pairs_per_box_master, pairs_per_box_colmeia, pairs_per_box_fitilho')
        .eq('id', soleGroupId)
        .maybeSingle();
      if (e2) throw e2;
      if (!pg) return [];

      const slotMap: Array<{ type: string; boxId: string | null; pairs: number | null }> = [
        { type: 'individual', boxId: pg.box_type_id,         pairs: pg.pairs_per_box_individual },
        { type: 'master',     boxId: pg.box_type_master_id,  pairs: pg.pairs_per_box_master },
        { type: 'colmeia',    boxId: pg.box_type_colmeia_id, pairs: pg.pairs_per_box_colmeia },
        { type: 'fitilho',    boxId: pg.box_type_fitilho_id, pairs: pg.pairs_per_box_fitilho },
      ].filter(s => !!s.boxId);

      if (slotMap.length === 0) return [];
      const ids = slotMap.map(s => s.boxId!) as string[];
      const { data: boxes, error: e3 } = await supabase
        .from('box_types')
        .select('id, nome, comprimento_cm, largura_cm, altura_cm, quantity, unit_price')
        .in('id', ids);
      if (e3) throw e3;

      return slotMap.map(s => {
        const bx = (boxes || []).find(b => b.id === s.boxId);
        return {
          packaging_type: s.type,
          nome: bx?.nome || s.type,
          pairs_per_box: s.pairs ?? 1,
          comprimento_cm: bx?.comprimento_cm ?? 0,
          largura_cm: bx?.largura_cm ?? 0,
          altura_cm: bx?.altura_cm ?? 0,
          cost_per_unit: bx?.unit_price ?? 0,
          box_type_id: s.boxId,
          box_types: { nome: bx?.nome, quantity: bx?.quantity },
        };
      });
    },
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  /** Configs active for the chosen mode */
  const relevant = configs.filter((c: any) => activeTypes.includes(c.packaging_type));

  /** Per-type breakdown */
  const breakdown = relevant.map((c: any) => {
    const pairsPerBox = Math.max(1, Number(c.pairs_per_box) || 1);
    const boxesNeeded = Math.ceil(qty / pairsPerBox);
    const costPerUnit = Number((c as any).cost_per_unit || 0);
    const l = Number(c.comprimento_cm) || 0;
    const w = Number(c.largura_cm) || 0;
    const h = Number(c.altura_cm) || 0;
    const volM3 = l * w * h / 1_000_000;
    const stockAvail = Number((c.box_types as any)?.quantity) ?? null;
    return {
      type: c.packaging_type as string,
      nome: (c.box_types as any)?.nome || c.nome || c.packaging_type,
      pairsPerBox,
      boxesNeeded,
      costPerUnit,
      totalCost: costPerUnit * boxesNeeded,
      volM3: volM3 * boxesNeeded,
      stockAvail,
      hasShortage: stockAvail !== null && stockAvail < boxesNeeded,
    };
  });

  /** Totals */
  const totalCost = breakdown.reduce((s, b) => s + b.totalCost, 0);
  const totalVolM3 = breakdown.reduce((s, b) => s + b.volM3, 0);
  const anyShortage = breakdown.some(b => b.hasShortage);

  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const modeLabel: Record<string, string> = {
    individual_amarrado: 'Amarrado',
    individual_master:   'Caixa Master',
    individual_fitilho:  'Fitilho',
    colmeia:             'Colméia',
  };

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="flex flex-row items-center space-x-2 pb-2">
        <Box className="h-5 w-5 text-primary" />
        <CardTitle className="text-base font-semibold">
          Sugestão — Pedido #{order.reference}
        </CardTitle>
        <Badge variant="outline" className="ml-auto text-xs">
          {modeLabel[mode] || mode}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {!order.sheetId ? (
          <div className="text-muted-foreground text-sm flex items-center gap-2">
            <Package className="h-4 w-4" />
            Selecione uma OP com ficha técnica para visualizar a sugestão de embalagem.
          </div>
        ) : relevant.length === 0 ? (
          <div className="text-muted-foreground text-sm flex items-center gap-2">
            <Package className="h-4 w-4" />
            Nenhuma embalagem configurada na ficha técnica para o modo <strong>{modeLabel[mode] || mode}</strong>.
            Configure embalagens na aba Embalagem da ficha técnica.
          </div>
        ) : (
          <>
            {/* Breakdown table */}
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 text-left">
                    <th className="p-2 pl-3 font-medium text-xs">Embalagem</th>
                    <th className="p-2 text-center font-medium text-xs">Pares/cx</th>
                    <th className="p-2 text-center font-medium text-xs">Qtd. Caixas</th>
                    <th className="p-2 text-center font-medium text-xs">Estoque</th>
                    <th className="p-2 text-right font-medium text-xs pr-3">Custo</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {breakdown.map(b => (
                    <tr key={b.type} className={b.hasShortage ? 'bg-destructive/5' : ''}>
                      <td className="p-2 pl-3">
                        <div className="flex items-center gap-2">
                          <PackageCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="font-medium text-xs">{b.nome}</span>
                          <Badge variant="outline" className="text-[9px] h-4">{b.type}</Badge>
                        </div>
                      </td>
                      <td className="p-2 text-center text-xs font-mono">{b.pairsPerBox}</td>
                      <td className="p-2 text-center">
                        <span className="font-bold text-sm">{b.boxesNeeded}</span>
                      </td>
                      <td className="p-2 text-center text-xs">
                        {b.stockAvail !== null ? (
                          <span className={b.hasShortage ? 'text-destructive font-semibold' : 'text-muted-foreground'}>
                            {b.stockAvail}
                            {b.hasShortage && <span className="ml-1 text-[10px] text-destructive">⚠ FALTA {b.boxesNeeded - b.stockAvail}</span>}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 text-right text-xs font-mono pr-3">
                        {b.totalCost > 0 ? fmtBRL(b.totalCost) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 bg-muted/40 rounded-lg">
                <p className="text-xs text-muted-foreground">Cubicagem estimada</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Layers className="h-4 w-4 text-primary" />
                  <span className="font-bold text-sm font-mono">
                    {totalVolM3 > 0 ? `${totalVolM3.toFixed(3)} m³` : `≈ ${(qty * 0.005).toFixed(3)} m³`}
                  </span>
                </div>
              </div>
              <div className="p-3 bg-muted/40 rounded-lg">
                <p className="text-xs text-muted-foreground">Custo total embalagem</p>
                <p className="font-bold text-sm mt-0.5">{totalCost > 0 ? fmtBRL(totalCost) : '—'}</p>
              </div>
              <div className="p-3 bg-muted/40 rounded-lg">
                <p className="text-xs text-muted-foreground">Total de pares</p>
                <p className="font-bold text-sm mt-0.5">{qty} pares</p>
              </div>
            </div>

            {anyShortage && (
              <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 p-3 rounded-lg text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>Estoque insuficiente em uma ou mais embalagens. Verifique os alertas acima antes de iniciar a embalagem.</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
