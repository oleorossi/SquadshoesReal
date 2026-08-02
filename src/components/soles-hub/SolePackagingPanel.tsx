import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Cube as Box, Stack as Layers, LinkSimple as Link2, Package, Info,
  Warning as AlertTriangle, Check, PencilSimple as Pencil, Plus, FloppyDisk as Save,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { BoxTypeFormDialog, type BoxKind, type BoxRow } from '@/components/packaging/BoxTypeFormDialog';

/**
 * Cadastro de embalagem DO SOLADO — fonte ÚNICA (decisão do dono, 02/08/2026).
 *
 * Grava em `product_groups.box_type_*_id` + `pairs_per_box_*`, que é o que
 * `debit_packaging_for_order`, `compute_sale_order_box_breakdown` (volumes da
 * NF) e `fn_projected_packaging_demand` (MRP) leem — todas migradas pra este
 * caminho único em `20261110120000`. O caminho antigo por ficha técnica
 * (`technical_sheet_box_types`) foi aposentado.
 *
 * Por que POR MODELO e não por cor: caixa é definida pelo formato do calçado,
 * não pela cor — mesma doutrina do Consumo Padrão. Um grupo de solado vale pras
 * suas N cores e pras N referências que o usam.
 *
 * Os TRÊS modos ficam configurados ao mesmo tempo porque quem escolhe o modo é
 * o Pedido de Venda (`sale_orders.packaging_mode`). Se o vendedor escolher um
 * modo que o solado não tem montado, o pedido entra e NADA é debitado.
 */

const NO_BOX = '__none__';

type ModeKey = 'tradicional' | 'amarrado' | 'colmeia';

interface SlotState {
  boxId: string;
  pairs: number;
}

type Slots = Record<BoxKind, SlotState>;

const emptySlots = (): Slots => ({
  individual: { boxId: NO_BOX, pairs: 0 },
  master: { boxId: NO_BOX, pairs: 0 },
  colmeia: { boxId: NO_BOX, pairs: 0 },
  fitilho: { boxId: NO_BOX, pairs: 0 },
});

const MODES: Array<{
  key: ModeKey;
  label: string;
  rule: string;
  icon: typeof Layers;
  /** Slots que o modo consome, na ordem da montagem física. */
  parts: BoxKind[];
}> = [
  { key: 'tradicional', label: 'Tradicional', rule: '1 master = 1 volume na nota', icon: Layers, parts: ['individual', 'master'] },
  { key: 'amarrado', label: 'Amarrado', rule: 'cada par = 1 volume na nota', icon: Link2, parts: ['individual', 'fitilho'] },
  { key: 'colmeia', label: 'Colméia', rule: '1 colmeia = 1 volume na nota', icon: Box, parts: ['colmeia'] },
];

const SLOT_ROLE: Record<BoxKind, string> = {
  individual: 'Caixa individual',
  master: 'Caixa master',
  colmeia: 'Caixa colmeia',
  fitilho: 'Fitilho',
};

/** Default canônico da RPC quando pares/caixa não é informado. */
const DEFAULT_PAIRS = 12;

const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });

interface Props {
  soleGroupId: string | null;
  soleGroupName: string;
}

export default function SolePackagingPanel({ soleGroupId, soleGroupName }: Props) {
  const qc = useQueryClient();
  const [slots, setSlots] = useState<Slots>(emptySlots());
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [boxDialog, setBoxDialog] = useState<{ box: BoxRow | null; tipo: BoxKind } | null>(null);

  const { data: group, isLoading: loadingGroup } = useQuery({
    queryKey: ['sole_packaging', soleGroupId],
    enabled: !!soleGroupId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('product_groups')
        .select('id, name, box_type_id, box_type_master_id, box_type_colmeia_id, box_type_fitilho_id, pairs_per_box_individual, pairs_per_box_master, pairs_per_box_colmeia, pairs_per_box_fitilho')
        .eq('id', soleGroupId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: boxes = [], isLoading: loadingBoxes } = useQuery({
    queryKey: ['box_types_stock'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('box_types')
        .select('*, suppliers:supplier_id(id, name)')
        .eq('active', true)
        .order('nome');
      if (error) throw error;
      return (data || []) as unknown as BoxRow[];
    },
    staleTime: 30_000,
  });

  // Quantas referências e cores herdam esta configuração — o operador precisa
  // ver o alcance antes de mexer.
  const { data: reach } = useQuery({
    queryKey: ['sole_packaging_reach', soleGroupId],
    enabled: !!soleGroupId,
    queryFn: async () => {
      const [{ count: cores }, { count: fichas }] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('group_id', soleGroupId!),
        supabase.from('technical_sheets').select('id', { count: 'exact', head: true }).eq('sole_group_id', soleGroupId!),
      ]);
      return { cores: cores ?? 0, fichas: fichas ?? 0 };
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!group) return;
    setSlots({
      individual: { boxId: group.box_type_id || NO_BOX, pairs: Number(group.pairs_per_box_individual || 0) },
      master: { boxId: group.box_type_master_id || NO_BOX, pairs: Number(group.pairs_per_box_master || 0) },
      colmeia: { boxId: group.box_type_colmeia_id || NO_BOX, pairs: Number(group.pairs_per_box_colmeia || 0) },
      fitilho: { boxId: group.box_type_fitilho_id || NO_BOX, pairs: Number(group.pairs_per_box_fitilho || 0) },
    });
    setDirty(false);
  }, [group]);

  const boxById = useMemo(() => {
    const m: Record<string, BoxRow> = {};
    for (const b of boxes) m[b.id] = b;
    return m;
  }, [boxes]);

  const boxesByKind = useMemo(() => {
    const m: Record<BoxKind, BoxRow[]> = { individual: [], master: [], colmeia: [], fitilho: [] };
    for (const b of boxes) m[(b.tipo || 'individual') as BoxKind].push(b);
    return m;
  }, [boxes]);

  const setSlot = (kind: BoxKind, patch: Partial<SlotState>) => {
    setSlots(prev => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
    setDirty(true);
  };

  /** Pares/caixa efetivo: valor do solado > padrão da caixa > 12 (espelha a RPC). */
  const effectivePairs = (kind: BoxKind): number => {
    const slot = slots[kind];
    if (slot.pairs > 0) return slot.pairs;
    const box = boxById[slot.boxId];
    const fromBox = Number(box?.pairs_per_box_default || 0);
    return fromBox > 0 ? fromBox : DEFAULT_PAIRS;
  };

  /** Custo por par do modo — soma de (preço da caixa ÷ pares que ela comporta). */
  const costPerPair = (parts: BoxKind[]): number | null => {
    let total = 0;
    for (const kind of parts) {
      const box = boxById[slots[kind].boxId];
      if (!box) return null;
      const pairs = Math.max(1, effectivePairs(kind));
      const price = Number(box.unit_price || 0);
      // Fitilho é linear: o preço é por metro e cada amarrado gasta N metros.
      const perUnit = kind === 'fitilho' ? price * Number(box.metros_per_amarrado_default || 1) : price;
      total += perUnit / pairs;
    }
    return total;
  };

  const modeReady = (parts: BoxKind[]) => parts.every(k => slots[k].boxId !== NO_BOX);

  const handleSave = async () => {
    if (!soleGroupId) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('product_groups')
        .update({
          box_type_id: slots.individual.boxId === NO_BOX ? null : slots.individual.boxId,
          box_type_master_id: slots.master.boxId === NO_BOX ? null : slots.master.boxId,
          box_type_colmeia_id: slots.colmeia.boxId === NO_BOX ? null : slots.colmeia.boxId,
          box_type_fitilho_id: slots.fitilho.boxId === NO_BOX ? null : slots.fitilho.boxId,
          pairs_per_box_individual: slots.individual.pairs > 0 ? slots.individual.pairs : null,
          pairs_per_box_master: slots.master.pairs > 0 ? slots.master.pairs : null,
          pairs_per_box_colmeia: slots.colmeia.pairs > 0 ? slots.colmeia.pairs : null,
          pairs_per_box_fitilho: slots.fitilho.pairs > 0 ? slots.fitilho.pairs : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', soleGroupId);
      if (error) throw error;
      toast.success('Embalagem do solado salva!');
      qc.invalidateQueries({ queryKey: ['sole_packaging', soleGroupId] });
      qc.invalidateQueries({ queryKey: ['packaging_links_overview_by_sole'] });
      qc.invalidateQueries({ queryKey: ['soles_without_packaging'] });
      setDirty(false);
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao salvar embalagem');
    } finally {
      setSaving(false);
    }
  };

  if (!soleGroupId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground space-y-2">
          <Package className="h-10 w-10 mx-auto opacity-30" />
          <p className="text-sm font-medium text-foreground">Este solado não está em nenhum grupo</p>
          <p className="text-xs max-w-md mx-auto">
            A embalagem é cadastrada por <strong>modelo de solado</strong> (o grupo). Vincule o solado a um
            grupo na aba Cadastro antes de configurar a caixa.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loadingGroup || loadingBoxes) {
    return <Skeleton className="h-72 w-full" />;
  }

  const renderSlot = (kind: BoxKind, note?: string) => {
    const slot = slots[kind];
    const box = boxById[slot.boxId];
    const options = boxesByKind[kind];
    const pairs = effectivePairs(kind);
    const pairsFromBox = slot.pairs <= 0;

    return (
      <div key={kind} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
            {SLOT_ROLE[kind]}
          </span>
          {note && <span className="text-[10px] text-muted-foreground">· {note}</span>}
          {box && <Check className="h-3.5 w-3.5 text-emerald-600 ml-auto shrink-0" />}
        </div>

        {options.length === 0 ? (
          <div className="rounded-md border border-dashed border-red-500/40 bg-red-500/5 p-3 space-y-2">
            <p className="text-xs text-red-600 font-medium">
              Nenhuma caixa do tipo {SLOT_ROLE[kind].toLowerCase()} cadastrada
            </p>
            <Button
              type="button" size="sm" variant="outline" className="h-8 gap-1.5 w-full"
              onClick={() => setBoxDialog({ box: null, tipo: kind })}
            >
              <Plus className="h-3.5 w-3.5" />
              Cadastrar {SLOT_ROLE[kind].toLowerCase()}
            </Button>
          </div>
        ) : (
          <>
            <Select value={slot.boxId} onValueChange={v => setSlot(kind, { boxId: v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Sem caixa" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_BOX}>Sem caixa</SelectItem>
                {options.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {box && (
              <div className="space-y-1.5">
                <div className="font-mono text-[11px] text-muted-foreground tabular-nums space-y-0.5">
                  <div>{box.comprimento_cm} × {box.largura_cm} × {box.altura_cm} cm</div>
                  <div className="flex flex-wrap gap-x-3">
                    <span className={Number(box.unit_price || 0) <= 0 ? 'text-red-600 font-semibold' : ''}>
                      {fmtBRL(Number(box.unit_price || 0))}{kind === 'fitilho' ? ' / m' : ''}
                    </span>
                    <span className={Number(box.quantity || 0) <= 0 ? 'text-red-600 font-semibold' : ''}>
                      {Number(box.quantity || 0)} {kind === 'fitilho' ? 'm' : 'un'} em estoque
                    </span>
                  </div>
                  {kind === 'fitilho' && (
                    <div>{Number(box.metros_per_amarrado_default || 1)} m / amarrado</div>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    {kind === 'fitilho' ? 'Pares por amarrado' : 'Pares por caixa'}
                  </Label>
                  <NumberInput
                    value={slot.pairs}
                    onChange={v => setSlot(kind, { pairs: v || 0 })}
                    min={0}
                    step="1"
                    decimals={0}
                    className="h-8"
                    placeholder={String(pairs)}
                    unit="par"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {pairsFromBox
                      ? `Vazio: usa ${pairs} do cadastro da caixa.`
                      : 'Valor específico deste solado.'}
                  </p>
                </div>

                <Button
                  type="button" size="sm" variant="ghost" className="h-7 gap-1.5 w-full text-xs"
                  onClick={() => setBoxDialog({ box, tipo: kind })}
                >
                  <Pencil className="h-3 w-3" />
                  Editar medidas, preço e estoque
                </Button>
              </div>
            )}

            {!box && (
              <Button
                type="button" size="sm" variant="ghost" className="h-7 gap-1.5 w-full text-xs"
                onClick={() => setBoxDialog({ box: null, tipo: kind })}
              >
                <Plus className="h-3 w-3" />
                Cadastrar outra {SLOT_ROLE[kind].toLowerCase()}
              </Button>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardContent className="py-3 px-4 flex items-start gap-2">
          <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="text-xs space-y-1">
            <p className="text-foreground font-medium">
              Embalagem é do MODELO de solado — vale pras {reach?.cores ?? 0}{' '}
              {reach?.cores === 1 ? 'cor' : 'cores'} de {soleGroupName} e pras {reach?.fichas ?? 0}{' '}
              {reach?.fichas === 1 ? 'referência que usa' : 'referências que usam'} este solado.
            </p>
            <p className="text-muted-foreground">
              Deixe os <strong>três modos montados</strong>: quem escolhe o modo é o Pedido de Venda. Se o
              PV pedir um modo sem caixa aqui, o pedido entra e <strong>nada é debitado</strong>. A caixa
              individual é a mesma no Tradicional e no Amarrado — muda só o que a agrupa.
            </p>
          </div>
        </CardContent>
      </Card>

      {MODES.map(mode => {
        const ready = modeReady(mode.parts);
        const cost = costPerPair(mode.parts);
        const Icon = mode.icon;
        return (
          <Card
            key={mode.key}
            className={`overflow-hidden border-l-4 ${ready ? 'border-l-emerald-500' : 'border-l-red-500'}`}
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Icon className="h-4 w-4 text-primary shrink-0" />
                <h4 className="text-sm font-bold uppercase tracking-tight">{mode.label}</h4>
                <span className="text-xs text-muted-foreground">{mode.rule}</span>
                <Badge
                  variant="outline"
                  className={`ml-auto text-xs ${ready
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                    : 'bg-red-500/10 text-red-600 border-red-500/30'}`}
                >
                  {ready ? 'Pronto' : 'Não debita'}
                </Badge>
              </div>

              <div className={`grid gap-3 ${mode.parts.length > 1 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
                {mode.parts.map(kind =>
                  renderSlot(kind, kind === 'individual' && mode.key === 'amarrado' ? 'mesma do Tradicional' : undefined)
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-dashed border-border pt-2.5">
                <div className="flex flex-col">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    {mode.key === 'colmeia' ? 'Pares / colmeia' : mode.key === 'amarrado' ? 'Pares / amarrado' : 'Pares / master'}
                  </span>
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {effectivePairs(mode.key === 'colmeia' ? 'colmeia' : mode.key === 'amarrado' ? 'fitilho' : 'master')}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Custo / par</span>
                  <span className={`font-mono text-sm font-semibold tabular-nums ${cost !== null && cost <= 0 ? 'text-red-600' : ''}`}>
                    {cost === null ? '—' : fmtBRL(cost)}
                  </span>
                </div>
                {ready && cost !== null && cost <= 0 && (
                  <span className="flex items-center gap-1 text-xs text-red-600">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Caixa sem preço — custo de embalagem sai zerado no custeio
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <div className="flex items-center justify-end gap-2 sticky bottom-0 bg-background/90 backdrop-blur-sm py-2 -mx-1 px-1">
        {dirty && <span className="text-xs text-amber-600 mr-auto">Alterações não salvas</span>}
        <Button onClick={handleSave} disabled={saving || !dirty} className="gap-1.5">
          <Save className="h-4 w-4" />
          {saving ? 'Salvando...' : 'Salvar embalagem'}
        </Button>
      </div>

      {boxDialog && (
        <BoxTypeFormDialog
          open
          onOpenChange={v => { if (!v) setBoxDialog(null); }}
          box={boxDialog.box}
          defaultTipo={boxDialog.tipo}
          onSaved={boxId => {
            // Caixa nova nasce já vinculada ao slot que a pediu — senão o
            // operador cadastra e a tela continua mostrando "sem caixa".
            if (!boxDialog.box) setSlot(boxDialog.tipo, { boxId });
            setBoxDialog(null);
          }}
        />
      )}
    </div>
  );
}
