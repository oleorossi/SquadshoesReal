import { useMemo, useState } from 'react';
import {
  Plus, LinkSimple as LinkIcon, Warning as AlertTriangle, FloppyDisk as Save,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useSheetMaterials, useUpdateSheetMaterial, useAddSheetMaterial, useDeleteSheetMaterial,
  type SheetFormData,
} from '@/hooks/useTechnicalSheets';
import { useProducts } from '@/hooks/useProducts';
import { formatCurrency } from '@/lib/utils';
import {
  allowsDraftMaterials,
  isUnlinkedDraftMaterial,
  lineDisplayName,
  pricingLineCostPerPair,
  resolveUnitPrice,
  sumActivePricingLines,
} from '@/lib/pricingSheetLineCost';
import { Link } from 'react-router-dom';

type SpecRow = {
  key: string;
  label: string;
  material: string;
  unit: string;
  consumption: number;
  unitPrice: number;
  cost: number;
  source: 'spec';
};

interface Props {
  sheetId: string;
  form: SheetFormData;
  /** Preço/dm² aproximado por nome de grupo (já calculado na CostsAnalysisTab ou 0). */
  groupPriceByName?: Record<string, number>;
}

/**
 * Grade estilo planilha da aba Precificação:
 * Especificações (leitura) + BOM/kit/ajustes editáveis + total MP.
 */
export function PricingBomGrid({ sheetId, form, groupPriceByName = {} }: Props) {
  const { data: materials = [], isLoading } = useSheetMaterials(sheetId);
  const updateMat = useUpdateSheetMaterial(sheetId);
  const addMat = useAddSheetMaterial();
  const deleteMat = useDeleteSheetMaterial(sheetId);
  const { data: products = [] } = useProducts();
  const canDraft = allowsDraftMaterials(form.status_ficha);
  const [addingDraft, setAddingDraft] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftPrice, setDraftPrice] = useState('');
  const [draftQty, setDraftQty] = useState('1');
  const [addMode, setAddMode] = useState<'estoque' | 'rascunho' | 'ajuste'>('estoque');
  const [productId, setProductId] = useState('');

  const specRows: SpecRow[] = useMemo(() => {
    const rows: SpecRow[] = [];
    // Prioriza grade por numeração (per-size); escalar só como fallback —
    // guard noScalarOnlyConsumption exige ler *_consumption_per_size neste arquivo.
    const effectiveConsumption = (
      perSize: Record<string, number> | null | undefined,
      fallbackAvg: number,
    ): number => {
      if (perSize && typeof perSize === 'object') {
        const vals = Object.values(perSize).map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0);
        if (vals.length > 0) return vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      return Number(fallbackAvg) || 0;
    };
    const push = (key: string, label: string, material: string, consumption: number) => {
      if (!material || !(consumption > 0)) return;
      const unitPrice = groupPriceByName[material] || 0;
      rows.push({
        key, label, material, unit: 'dm²', consumption, unitPrice,
        cost: consumption * unitPrice, source: 'spec',
      });
    };
    push(
      'upper',
      'Cabedal',
      form.upper_material,
      effectiveConsumption(form.upper_consumption_per_size, form.upper_consumption),
    );
    push(
      'lining',
      'Forração',
      form.lining_material,
      effectiveConsumption(form.lining_consumption_per_size, form.lining_consumption),
    );
    push(
      'insole',
      'Palmilha',
      form.insole_material,
      effectiveConsumption(form.insole_consumption_per_size, form.insole_consumption),
    );
    push('sole', 'Solado', form.sole_material, Number(form.sole_consumption) || 0);
    return rows;
  }, [form, groupPriceByName]);

  const bomLines = materials as any[];
  const specsTotal = specRows.reduce((s, r) => s + r.cost, 0);
  const bomTotal = sumActivePricingLines(bomLines);
  const totalMp = specsTotal + bomTotal;
  const unlinked = bomLines.filter(isUnlinkedDraftMaterial);

  const handleAdd = async () => {
    if (addMode === 'ajuste') {
      await addMat.mutateAsync({
        sheetId,
        data: {
          product_id: null as any,
          quantity_per_unit: 1,
          color: '', width: '', weight: '', supplier: '', notes: '', sizes: '',
          consumption_sector: '',
          part_name: draftName.trim() || 'Ajuste',
          draft_name: draftName.trim() || 'Ajuste',
          line_kind: 'ajuste',
          cost_mode: 'fixed_per_pair',
          cost_per_pair: Number(draftPrice) || 0,
          is_active: true,
          include_in_consumption: false,
        } as any,
      });
    } else if (addMode === 'rascunho') {
      if (!canDraft) {
        return;
      }
      await addMat.mutateAsync({
        sheetId,
        data: {
          product_id: null as any,
          quantity_per_unit: Number(draftQty) || 1,
          color: '', width: '', weight: '', supplier: '', notes: '', sizes: '',
          consumption_sector: '',
          part_name: draftName.trim(),
          draft_name: draftName.trim(),
          line_kind: 'material',
          cost_mode: 'consumo_x_preco',
          estimated_unit_price: Number(draftPrice) || 0,
          is_active: true,
          include_in_consumption: false,
        } as any,
      });
    } else {
      if (!productId) return;
      const prod = (products as any[]).find(p => p.id === productId);
      await addMat.mutateAsync({
        sheetId,
        data: {
          product_id: productId,
          group_id: prod?.group_id || null,
          quantity_per_unit: Number(draftQty) || 1,
          color: '', width: '', weight: '', supplier: '', notes: '', sizes: '',
          consumption_sector: '',
          part_name: prod?.name || '',
          line_kind: 'material',
          cost_mode: 'consumo_x_preco',
          is_active: true,
          include_in_consumption: true,
        } as any,
      });
    }
    setAddingDraft(false);
    setDraftName('');
    setDraftPrice('');
    setDraftQty('1');
    setProductId('');
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-muted/30 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">MATERIAIS · Precificação</div>
            <div className="text-xs text-muted-foreground">
              Especificações (leitura) + BOM / kit / ajustes. Preço de estoque ou estimado no rascunho.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unlinked.length > 0 && (
              <Badge variant="outline" className="text-warning border-warning/40 gap-1">
                <AlertTriangle className="h-3 w-3" />
                {unlinked.length} sem vínculo
              </Badge>
            )}
            <Badge variant="secondary" className="tabular-nums">
              {form.status_ficha || 'rascunho'}
            </Badge>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider border-b">
              <tr>
                <th className="p-2 text-left font-medium w-10">IT</th>
                <th className="p-2 text-left font-medium">Materiais</th>
                <th className="p-2 text-center font-medium">unid</th>
                <th className="p-2 text-right font-medium">consumo</th>
                <th className="p-2 text-right font-medium">preço</th>
                <th className="p-2 text-right font-medium">CUSTO</th>
                <th className="p-2 text-center font-medium">Ativo</th>
                <th className="p-2 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {specRows.map((row, idx) => (
                <tr key={row.key} className="bg-muted/10">
                  <td className="p-2 tabular-nums text-muted-foreground">{String(idx + 1).padStart(2, '0')}</td>
                  <td className="p-2">
                    <span className="font-medium">{row.label}</span>
                    <span className="text-muted-foreground"> — {row.material}</span>
                    <Badge variant="outline" className="ml-2 text-[10px]">ficha</Badge>
                  </td>
                  <td className="p-2 text-center font-mono text-xs">{row.unit}</td>
                  <td className="p-2 text-right tabular-nums">{row.consumption.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td>
                  <td className="p-2 text-right tabular-nums text-muted-foreground">{formatCurrency(row.unitPrice)}</td>
                  <td className="p-2 text-right tabular-nums font-medium">{formatCurrency(row.cost)}</td>
                  <td className="p-2 text-center text-xs text-muted-foreground">S</td>
                  <td />
                </tr>
              ))}

              {isLoading && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Carregando BOM…</td></tr>
              )}

              {bomLines.map((line, idx) => (
                <BomEditableRow
                  key={line.id}
                  index={specRows.length + idx + 1}
                  line={line}
                  canDraft={canDraft}
                  products={products as any[]}
                  onUpdate={(data) => updateMat.mutateAsync({ id: line.id, data: data as any })}
                  onDelete={() => deleteMat.mutateAsync(line.id)}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30">
                <td colSpan={5} className="p-3 text-right text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  TOTAL CUSTO M.P.
                </td>
                <td className="p-3 text-right text-base font-bold tabular-nums">{formatCurrency(totalMp)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="border-t p-3 space-y-3 bg-muted/10">
          {!addingDraft ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => { setAddMode('estoque'); setAddingDraft(true); }}>
                <Plus className="h-3.5 w-3.5" /> Do estoque
              </Button>
              {canDraft && (
                <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => { setAddMode('rascunho'); setAddingDraft(true); }}>
                  <Plus className="h-3.5 w-3.5" /> Rascunho (sem estoque)
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => { setAddMode('ajuste'); setAddingDraft(true); }}>
                <Plus className="h-3.5 w-3.5" /> Ajuste (+R$)
              </Button>
              <Button type="button" size="sm" variant="ghost" asChild className="ml-auto text-xs">
                <Link to="/engenharia/materiais-base">Configurar materiais base</Link>
              </Button>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-card p-3 grid gap-2 sm:grid-cols-4">
              {addMode === 'estoque' ? (
                <div className="sm:col-span-2">
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Produto…" /></SelectTrigger>
                    <SelectContent>
                      {(products as any[]).slice(0, 500).map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <Input className="h-9" placeholder="Descrição" value={draftName} onChange={e => setDraftName(e.target.value)} />
                </div>
              )}
              <Input className="h-9" placeholder={addMode === 'ajuste' ? 'R$/par' : 'Consumo'} value={addMode === 'ajuste' ? draftPrice : draftQty} onChange={e => addMode === 'ajuste' ? setDraftPrice(e.target.value) : setDraftQty(e.target.value)} />
              {addMode !== 'ajuste' && addMode !== 'estoque' && (
                <Input className="h-9" placeholder="Preço estimado" value={draftPrice} onChange={e => setDraftPrice(e.target.value)} />
              )}
              {addMode === 'estoque' && (
                <Input className="h-9" placeholder="Consumo/par" value={draftQty} onChange={e => setDraftQty(e.target.value)} />
              )}
              <div className="flex gap-2 sm:col-span-4 justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => setAddingDraft(false)}>Cancelar</Button>
                <Button type="button" size="sm" className="gap-1.5" onClick={() => void handleAdd()} disabled={addMat.isPending}>
                  <Save className="h-3.5 w-3.5" /> Adicionar
                </Button>
              </div>
            </div>
          )}

          {!canDraft && (
            <p className="text-xs text-muted-foreground">
              Ficha {form.status_ficha}: linhas-rascunho (sem estoque) não podem ser criadas. Vincule as existentes antes de validar/publicar.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function BomEditableRow({
  index,
  line,
  canDraft,
  products,
  onUpdate,
  onDelete,
}: {
  index: number;
  line: any;
  canDraft: boolean;
  products: any[];
  onUpdate: (data: Record<string, unknown>) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [qty, setQty] = useState(String(line.quantity_per_unit ?? 1));
  const [estPrice, setEstPrice] = useState(String(line.estimated_unit_price ?? line.cost_per_pair ?? ''));
  const [active, setActive] = useState(line.is_active !== false);
  const [linkProductId, setLinkProductId] = useState('');
  const unlinked = isUnlinkedDraftMaterial(line);
  const unitPrice = resolveUnitPrice(line);
  const cost = pricingLineCostPerPair({ ...line, is_active: active });
  const isFixed = line.cost_mode === 'fixed_per_pair' || line.line_kind === 'ajuste';
  const unitLabel = line.products?.unit || (isFixed ? 'par' : 'un');

  return (
    <tr className={!active ? 'opacity-50' : undefined}>
      <td className="p-2 tabular-nums text-muted-foreground">{String(index).padStart(2, '0')}</td>
      <td className="p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{lineDisplayName(line)}</span>
          {line.line_kind === 'ajuste' && <Badge variant="outline" className="text-[10px]">ajuste</Badge>}
          {line.from_kit_item_id && <Badge variant="secondary" className="text-[10px]">kit</Badge>}
          {unlinked && <Badge variant="outline" className="text-[10px] text-warning border-warning/40">rascunho</Badge>}
        </div>
        {unlinked && canDraft && (
          <div className="mt-1.5 flex gap-1.5 max-w-sm">
            <Select value={linkProductId} onValueChange={setLinkProductId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Vincular estoque…" /></SelectTrigger>
              <SelectContent>
                {products.slice(0, 500).map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1"
              disabled={!linkProductId}
              onClick={() => void onUpdate({
                product_id: linkProductId,
                draft_name: null,
                estimated_unit_price: null,
              })}
            >
              <LinkIcon className="h-3 w-3" /> Vincular
            </Button>
          </div>
        )}
      </td>
      <td className="p-2 text-center font-mono text-xs">{unitLabel}</td>
      <td className="p-2">
        {isFixed ? (
          <span className="block text-right tabular-nums">1,00</span>
        ) : (
          <Input className="h-8 text-right font-mono" value={qty} onChange={e => setQty(e.target.value)}
            onBlur={() => {
              const n = Number(qty);
              if (Number.isFinite(n) && n !== Number(line.quantity_per_unit)) {
                void onUpdate({ quantity_per_unit: n });
              }
            }}
          />
        )}
      </td>
      <td className="p-2">
        {line.product_id && !isFixed ? (
          <span className="block text-right tabular-nums text-muted-foreground">{formatCurrency(unitPrice)}</span>
        ) : (
          <Input
            className="h-8 text-right font-mono"
            value={estPrice}
            onChange={e => setEstPrice(e.target.value)}
            onBlur={() => {
              const n = Number(estPrice);
              if (!Number.isFinite(n)) return;
              if (isFixed) {
                if (n !== Number(line.cost_per_pair)) void onUpdate({ cost_per_pair: n, estimated_unit_price: unlinked ? n : line.estimated_unit_price });
              } else if (n !== Number(line.estimated_unit_price)) {
                void onUpdate({ estimated_unit_price: n });
              }
            }}
          />
        )}
      </td>
      <td className="p-2 text-right tabular-nums font-medium">{formatCurrency(cost)}</td>
      <td className="p-2 text-center">
        <Switch
          checked={active}
          onCheckedChange={(v) => {
            setActive(v);
            void onUpdate({ is_active: v });
          }}
          aria-label="Ativo"
        />
      </td>
      <td className="p-2 text-right">
        <Button type="button" size="sm" variant="ghost" className="h-8 text-destructive text-xs" onClick={() => void onDelete()}>
          Excluir
        </Button>
      </td>
    </tr>
  );
}

export default PricingBomGrid;
