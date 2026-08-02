import { Cube as Box, Stack as Layers, Package as PackageCheck, WarningCircle as AlertCircle, Package } from '@phosphor-icons/react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** packaging modes → which packaging_type rows are consumed.
 *  Espelha `resolveTypesForMode` (utils/sole-packaging-debit.ts) e a RPC viva:
 *  'individual_amarrado' é sinônimo de 'individual_fitilho' e debita os DOIS
 *  tipos — antes esta tabela listava só 'individual' e a sugestão escondia o
 *  fitilho que o débito consome. */
const MODE_TYPES: Record<string, string[]> = {
  colmeia:            ['colmeia'],
  individual_master:  ['individual', 'master'],
  individual_fitilho: ['individual', 'fitilho'],
  individual_amarrado:['individual', 'fitilho'],
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

  const { data: configs = [], isLoading, error: configsError } = useQuery({
    queryKey: ['packaging_configs_decision', order.sheetId],
    enabled: !!order.sheetId,
    queryFn: async () => {
      // Fonte canônica desde 02/08/2026: os slots do MODELO DE SOLADO
      // (`product_groups.box_type_*`), que é o que `debit_packaging_for_order`
      // debita. O caminho antigo por ficha (`technical_sheet_box_types`) foi
      // aposentado — se esta tela continuasse lendo de lá, a sugestão mostraria
      // caixa diferente da que sai do estoque.
      const { data: sheet, error: sheetErr } = await supabase
        .from('technical_sheets')
        .select('sole_group_id')
        .eq('id', order.sheetId!)
        .maybeSingle();
      if (sheetErr) throw sheetErr;

      const soleGroupId = (sheet as any)?.sole_group_id as string | null;
      if (!soleGroupId) return [];

      const { data, error } = await (supabase as any)
        .from('product_groups')
        .select(`
          pairs_per_box_individual, pairs_per_box_master, pairs_per_box_colmeia, pairs_per_box_fitilho,
          box_individual:box_type_id(id, nome, tipo, pairs_per_box_default, metros_per_amarrado_default, comprimento_cm, largura_cm, altura_cm, quantity, unit_price),
          box_master:box_type_master_id(id, nome, tipo, pairs_per_box_default, metros_per_amarrado_default, comprimento_cm, largura_cm, altura_cm, quantity, unit_price),
          box_colmeia:box_type_colmeia_id(id, nome, tipo, pairs_per_box_default, metros_per_amarrado_default, comprimento_cm, largura_cm, altura_cm, quantity, unit_price),
          box_fitilho:box_type_fitilho_id(id, nome, tipo, pairs_per_box_default, metros_per_amarrado_default, comprimento_cm, largura_cm, altura_cm, quantity, unit_price)
        `)
        .eq('id', soleGroupId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return [];

      const slots: Array<{ key: string; box: any; pairs: number | null }> = [
        { key: 'individual', box: data.box_individual, pairs: data.pairs_per_box_individual },
        { key: 'master', box: data.box_master, pairs: data.pairs_per_box_master },
        { key: 'colmeia', box: data.box_colmeia, pairs: data.pairs_per_box_colmeia },
        { key: 'fitilho', box: data.box_fitilho, pairs: data.pairs_per_box_fitilho },
      ];

      return slots.flatMap(({ key, box, pairs }) => {
        const b = Array.isArray(box) ? box[0] : box;
        if (!b) return [];
        return [{
          packaging_type: (b.tipo ?? key) as string,
          nome: b.nome ?? 'Embalagem',
          // Precedência igual à da RPC: valor do solado > padrão da caixa > 12.
          pairs_per_box: Number(pairs || 0) > 0 ? Number(pairs) : Number(b.pairs_per_box_default || 12),
          comprimento_cm: b.comprimento_cm ?? 0,
          largura_cm: b.largura_cm ?? 0,
          altura_cm: b.altura_cm ?? 0,
          // Fitilho é linear: o preço é por metro e cada amarrado gasta N metros.
          cost_per_unit: b.tipo === 'fitilho'
            ? Number(b.unit_price ?? 0) * Number(b.metros_per_amarrado_default ?? 1)
            : Number(b.unit_price ?? 0),
          box_type_id: b.id,
          box_types: { nome: b.nome, quantity: b.quantity },
        }];
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
    const stockValue = Number((c.box_types as any)?.quantity);
    const stockAvail = Number.isFinite(stockValue) ? stockValue : null;
    return {
      type: c.packaging_type as string,
      nome: (c.box_types as any)?.nome || c.nome || c.packaging_type,
      pairsPerBox,
      boxesNeeded,
      costPerUnit,
      totalCost: costPerUnit * boxesNeeded,
      volM3: volM3 * boxesNeeded,
      stockAvail,
      stockUnavailable: stockAvail === null,
      hasShortage: stockAvail === null || stockAvail < boxesNeeded,
    };
  });

  /** Totals */
  const totalCost = breakdown.reduce((s, b) => s + b.totalCost, 0);
  const totalVolM3 = breakdown.reduce((s, b) => s + b.volM3, 0);
  const anyShortage = breakdown.some(b => b.hasShortage);

  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const modeLabel: Record<string, string> = {
    individual_master:   'Tradicional (Individual + Master)',
    colmeia:             'Caixa Colméia',
    individual_fitilho:  'Amarrado (Individual + Fitilho)',
    individual_amarrado: 'Apenas Individual (legado)',
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
        ) : configsError ? (
          <div className="text-destructive text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Não foi possível consultar as embalagens vinculadas à ficha: {(configsError as Error).message}
          </div>
        ) : relevant.length === 0 ? (
          <div className="text-muted-foreground text-sm flex items-center gap-2">
            <Package className="h-4 w-4" />
            Nenhuma caixa configurada no solado desta referência para o modo <strong>{modeLabel[mode] || mode}</strong>.
            Configure em Solados → Consumos → Embalagem. Sem isso, o pedido entra mas nada é debitado.
          </div>
        ) : (
          <>
            {/* Breakdown table */}
            <div className="rounded-lg border overflow-hidden">
              {/* Audit A8: scroll horizontal interno — overflow-hidden do card clipava as colunas finais em 360px */}
              <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="bg-muted/30 text-left">
                    <th scope="col" className="p-2 pl-3 font-medium text-xs">Embalagem</th>
                    <th scope="col" className="p-2 text-center font-medium text-xs">Pares/cx</th>
                    <th scope="col" className="p-2 text-center font-medium text-xs">Qtd. Caixas</th>
                    <th scope="col" className="p-2 text-center font-medium text-xs">Estoque</th>
                    <th scope="col" className="p-2 text-right font-medium text-xs pr-3">Custo</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {breakdown.map(b => (
                    <tr key={b.type} className={b.hasShortage ? 'bg-destructive/5' : ''}>
                      <td className="p-2 pl-3">
                        <div className="flex items-center gap-2">
                          <PackageCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="font-medium text-xs">{b.nome}</span>
                          <Badge variant="outline" className="text-xs h-4">{b.type}</Badge>
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
                            {b.hasShortage && <span className="ml-1 text-xs text-destructive">⚠ FALTA {b.boxesNeeded - b.stockAvail}</span>}
                          </span>
                        ) : <span className="text-destructive font-semibold">Indisponível</span>}
                      </td>
                      <td className="p-2 text-right text-xs font-mono pr-3">
                        {b.totalCost > 0 ? fmtBRL(b.totalCost) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
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
