import { useMemo, useState } from 'react';
import { CheckCircle, GridFour, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type ArtisanalStrapCatalog,
  type ArtisanalStrapCatalogProduct,
  type ArtisanalStrapSourceMode,
  useDesignateBaseMaterialOfficialProduct,
  useSaveArtisanalStrapBundle,
} from '@/hooks/useArtisanalStraps';
import { useSuppliers } from '@/hooks/useSuppliers';

interface RowConfig {
  minStockM: number;
  floorMode: ArtisanalStrapSourceMode;
  purchaseEnabled: boolean;
  supplierId: string;
  purchasePrice: number;
  minOrderQuantity: number;
  purchaseMultiple: number;
  preparationDays: number;
}

interface Combo {
  key: string;
  measureId: string;
  baseGroupId: string;
  colorId: string;
}

interface ResultLine extends Combo {
  label: string;
  status: 'created' | 'skipped' | 'blocked';
  detail: string;
}

function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, checked: boolean) {
  setter((current) => {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });
}

function modal<T extends string | number | boolean>(values: T[], fallback: T): T {
  if (values.length === 0) return fallback;
  const counts = new Map<T, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function defaultConfig(catalog: ArtisanalStrapCatalog, combo: Combo): RowConfig {
  const siblings = catalog.variants.filter((variant) =>
    variant.measure_id === combo.measureId && variant.base_group_id === combo.baseGroupId);
  return {
    minStockM: modal(siblings.map((variant) => Number(variant.min_stock_m)), 0),
    floorMode: modal(siblings.map((variant) => variant.min_stock_replenishment_mode), 'internal'),
    purchaseEnabled: modal(siblings.map((variant) => Boolean(variant.purchase_enabled)), false),
    supplierId: '',
    purchasePrice: 0,
    minOrderQuantity: 1,
    purchaseMultiple: 1,
    preparationDays: 2,
  };
}

function skuToken(value: unknown, fallback: string, maxLength: number) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (normalized || fallback).slice(0, maxLength);
}

function generatedSku(catalog: ArtisanalStrapCatalog, combo: Combo) {
  const measure = catalog.measures.find((item) => item.id === combo.measureId);
  const base = catalog.groups.find((item) => item.id === combo.baseGroupId);
  const color = catalog.colors.find((item) => item.id === combo.colorId);
  // A base fica legível e o UUID completo evita a colisão dos antigos IDs
  // truncados. O SKU continua abaixo de 100 caracteres.
  return [
    'TIR',
    skuToken(base?.name, 'BASE', 14),
    skuToken(measure?.display_name, 'MEDIDA', 8),
    skuToken(color?.name, 'COR', 10),
    crypto.randomUUID().toUpperCase(),
  ].join('-');
}

function normalizedColorKey(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function ArtisanalStrapBatchMatrix({ catalog }: { catalog: ArtisanalStrapCatalog }) {
  const [open, setOpen] = useState(false);
  const [baseIds, setBaseIds] = useState<Set<string>>(new Set());
  const [colorIds, setColorIds] = useState<Set<string>>(new Set());
  const [measureIds, setMeasureIds] = useState<Set<string>>(new Set());
  const [configs, setConfigs] = useState<Record<string, RowConfig>>({});
  const [candidateSelections, setCandidateSelections] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('Cadastro em lote base × cor × medida');
  const [floorsConfirmed, setFloorsConfirmed] = useState(false);
  const [results, setResults] = useState<ResultLine[]>([]);
  const [saving, setSaving] = useState(false);
  const save = useSaveArtisanalStrapBundle();
  const designateOfficial = useDesignateBaseMaterialOfficialProduct();
  const { data: suppliers = [] } = useSuppliers(open);

  const activeOfficial = catalog.official_products.filter((official) =>
    official.status === 'active'
    && catalog.products.some((product) => product.id === official.official_product_id && product.active !== false));
  const canonicalColorIdsByKey = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (key: string, colorId: string) => {
      if (!key) return;
      const ids = map.get(key) || new Set<string>();
      ids.add(colorId);
      map.set(key, ids);
    };
    catalog.colors.filter((color) => color.active).forEach((color) => add(normalizedColorKey(color.name), color.id));
    catalog.aliases
      .filter((alias) => alias.status === 'approved')
      .forEach((alias) => add(normalizedColorKey(alias.alias), alias.canonical_color_id));
    return map;
  }, [catalog.aliases, catalog.colors]);
  const candidateProductsByPair = useMemo(() => {
    const map = new Map<string, ArtisanalStrapCatalogProduct[]>();
    catalog.products.filter((product) => product.active !== false && product.group_id && product.color).forEach((product) => {
      const resolvedIds = canonicalColorIdsByKey.get(normalizedColorKey(product.color));
      // Texto ambíguo ou sem alias aprovado nunca vira identidade por adivinhação.
      if (!resolvedIds || resolvedIds.size !== 1) return;
      const colorId = [...resolvedIds][0];
      const key = `${product.group_id}:${colorId}`;
      map.set(key, [...(map.get(key) || []), product]);
    });
    return map;
  }, [canonicalColorIdsByKey, catalog.products]);
  const baseOptions = catalog.groups.filter((group) =>
    activeOfficial.some((official) => official.base_group_id === group.id)
    || [...candidateProductsByPair.keys()].some((key) => key.startsWith(`${group.id}:`)));
  const colorOptions = catalog.colors.filter((color) => color.active && [...baseIds].some((baseGroupId) =>
    activeOfficial.some((official) => official.base_group_id === baseGroupId && official.color_id === color.id)
    || candidateProductsByPair.has(`${baseGroupId}:${color.id}`)));
  const measureOptions = catalog.measures.filter((measure) => measure.active);
  const combos = useMemo(() => {
    const rows: Combo[] = [];
    measureIds.forEach((measureId) => baseIds.forEach((baseGroupId) => colorIds.forEach((colorId) => rows.push({
      key: `${measureId}:${baseGroupId}:${colorId}`,
      measureId,
      baseGroupId,
      colorId,
    }))));
    return rows;
  }, [measureIds, baseIds, colorIds]);

  const configFor = (combo: Combo) => configs[combo.key] || defaultConfig(catalog, combo);
  const updateConfig = (combo: Combo, patch: Partial<RowConfig>) => {
    setConfigs((current) => ({ ...current, [combo.key]: { ...configFor(combo), ...patch } }));
    setFloorsConfirmed(false);
  };
  const labelFor = (combo: Combo) => {
    const measure = catalog.measures.find((item) => item.id === combo.measureId);
    const type = catalog.types.find((item) => item.id === measure?.strap_type_id);
    const base = catalog.groups.find((item) => item.id === combo.baseGroupId);
    const color = catalog.colors.find((item) => item.id === combo.colorId);
    return [type?.name, measure?.display_name, base?.name, color?.name].filter(Boolean).join(' · ');
  };
  const candidatesFor = (combo: Combo) => candidateProductsByPair.get(`${combo.baseGroupId}:${combo.colorId}`) || [];
  const availabilityFor = (baseGroupId: string, colorId: string) => {
    const official = activeOfficial.filter((entry) => entry.base_group_id === baseGroupId && entry.color_id === colorId);
    if (official.length === 1) return { label: 'oficial', variant: 'secondary' as const };
    const candidates = candidateProductsByPair.get(`${baseGroupId}:${colorId}`) || [];
    if (candidates.length === 1) return { label: 'vínculo pendente', variant: 'outline' as const };
    if (candidates.length > 1) return { label: `${candidates.length} candidatas`, variant: 'destructive' as const };
    return null;
  };
  const issueFor = (combo: Combo): string | null => {
    const officialCount = activeOfficial.filter((official) =>
      official.base_group_id === combo.baseGroupId && official.color_id === combo.colorId).length;
    const candidates = candidatesFor(combo);
    if (officialCount === 0 && candidates.length === 0) return 'Cor sem napa oficial nem produto ativo com cor canônica/alias aprovado nesta base.';
    if (officialCount === 0 && candidates.length === 1) return `Produto-base ${candidates[0].name} ainda precisa ser designado oficial.`;
    if (officialCount === 0 && candidates.length > 1) return 'Mais de um produto-base ativo corresponde à cor; escolha e designe o oficial.';
    if (officialCount > 1) return 'Mais de um produto-base oficial ativo; resolva a ambiguidade.';
    const config = configFor(combo);
    if (config.minStockM < 0) return 'Estoque mínimo negativo.';
    if (config.purchaseEnabled || config.floorMode === 'buy_ready') {
      if (!catalog.capabilities.can_see_financial_values) return 'Compra pronta exige acesso financeiro.';
      if (config.purchasePrice <= 0) return 'Informe o preço de compra.';
      if (config.minOrderQuantity <= 0 || config.purchaseMultiple <= 0) return 'MOQ e múltiplo devem ser positivos.';
    }
    return null;
  };

  const run = async () => {
    if (!floorsConfirmed) return toast.error('Confirme explicitamente os pisos de estoque.');
    if (!reason.trim()) return toast.error('Informe o motivo da criação em lote.');
    setSaving(true);
    const output: ResultLine[] = [];
    for (const combo of combos) {
      const label = labelFor(combo);
      const existing = catalog.variants.find((variant) =>
        variant.measure_id === combo.measureId
        && variant.base_group_id === combo.baseGroupId
        && variant.color_id === combo.colorId);
      if (existing) {
        output.push({ ...combo, label, status: 'skipped', detail: 'Combinação já existe; nada foi alterado.' });
        continue;
      }
      const issue = issueFor(combo);
      if (issue) {
        output.push({ ...combo, label, status: 'blocked', detail: issue });
        continue;
      }
      const measure = catalog.measures.find((item) => item.id === combo.measureId)!;
      const config = configFor(combo);
      try {
        await save.mutateAsync({
          reason: reason.trim(),
          payload: {
            type: { id: measure.strap_type_id },
            measure: { id: combo.measureId },
            variant: {
              base_group_id: combo.baseGroupId,
              color_id: combo.colorId,
              min_stock_m: config.minStockM,
              min_stock_replenishment_mode: config.floorMode,
              purchase_enabled: config.purchaseEnabled || config.floorMode === 'buy_ready',
              status: 'review_required',
              review_reason: 'Criada pela matriz; revisar receita e identidade comercial.',
            },
            product: {
              name: label,
              sku: generatedSku(catalog, combo),
              ...(config.purchaseEnabled || config.floorMode === 'buy_ready' ? {
                supplier_id: config.supplierId || null,
                purchase_unit: 'm',
                conversion_rate: 1,
                purchase_price: config.purchasePrice,
                min_order_quantity: config.minOrderQuantity,
                purchase_multiple: config.purchaseMultiple,
                material_preparation_days: config.preparationDays,
              } : {}),
            },
          },
        });
        output.push({ ...combo, label, status: 'created', detail: 'Criada em revisão obrigatória.' });
      } catch (error) {
        output.push({ ...combo, label, status: 'blocked', detail: error instanceof Error ? error.message : 'Falha na RPC canônica.' });
      }
    }
    setResults(output);
    setSaving(false);
    const created = output.filter((item) => item.status === 'created').length;
    toast.success(`Matriz concluída: ${created} criada(s), ${output.filter((item) => item.status === 'skipped').length} pulada(s), ${output.filter((item) => item.status === 'blocked').length} bloqueada(s).`);
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <GridFour className="h-4 w-4" /> Criar matriz
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader><DialogTitle>Matriz de combinações</DialogTitle><DialogDescription>Selecione base(s), cores canônicas com napa oficial ou candidata e medida(s). A prévia nunca sobrescreve combinação existente nem escolhe produto ambíguo.</DialogDescription></DialogHeader>
          <div className="grid gap-4 lg:grid-cols-3">
            <fieldset className="space-y-2 rounded-lg border p-3"><legend className="px-1 text-xs font-bold uppercase">1 · Napas-base</legend>{baseOptions.map((base) => <label key={base.id} className="flex items-center gap-2 text-sm"><Checkbox checked={baseIds.has(base.id)} onCheckedChange={(value) => toggle(setBaseIds, base.id, value === true)} />{base.name}</label>)}</fieldset>
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs font-bold uppercase">2 · Cores por napa-base</legend>
              {baseIds.size === 0 ? <p className="text-xs text-muted-foreground">Escolha uma base primeiro.</p> : colorOptions.map((color) => (
                <label key={color.id} className="flex items-start gap-2 text-sm">
                  <Checkbox checked={colorIds.has(color.id)} onCheckedChange={(value) => toggle(setColorIds, color.id, value === true)} />
                  <span>{color.name}<span className="mt-1 flex flex-wrap gap-1">
                    {baseOptions.filter((base) => baseIds.has(base.id)).map((base) => {
                      const availability = availabilityFor(base.id, color.id);
                      return availability ? <Badge key={base.id} variant={availability.variant} className="text-[9px]">{base.name} · {availability.label}</Badge> : null;
                    })}
                  </span></span>
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-2 rounded-lg border p-3"><legend className="px-1 text-xs font-bold uppercase">3 · Medidas</legend>{measureOptions.map((measure) => <label key={measure.id} className="flex items-center gap-2 text-sm"><Checkbox checked={measureIds.has(measure.id)} onCheckedChange={(value) => toggle(setMeasureIds, measure.id, value === true)} />{measure.display_name}</label>)}</fieldset>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between"><h3 className="text-sm font-bold">Prévia ({combos.length})</h3><Badge variant="outline">existentes são puladas</Badge></div>
            {combos.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Selecione ao menos uma opção em cada coluna.</p> : combos.map((combo) => {
              const config = configFor(combo);
              const existing = catalog.variants.some((variant) => variant.measure_id === combo.measureId && variant.base_group_id === combo.baseGroupId && variant.color_id === combo.colorId);
              const issue = issueFor(combo);
              const candidates = candidatesFor(combo);
              const officialCount = activeOfficial.filter((official) => official.base_group_id === combo.baseGroupId && official.color_id === combo.colorId).length;
              const pairKey = `${combo.baseGroupId}:${combo.colorId}`;
              const selectedCandidateId = candidateSelections[pairKey] || (candidates.length === 1 ? candidates[0].id : '');
              return (
                <article key={combo.key} className="rounded-lg border p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-semibold">{labelFor(combo)}</p>{existing ? <Badge variant="secondary">Pulada · já existe</Badge> : issue ? <Badge variant="destructive">Bloqueada</Badge> : <Badge variant="outline">Disponível para adicionar</Badge>}</div>
                  {!existing && <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="space-y-1"><Label>Estoque mínimo</Label><NumberInput value={config.minStockM} onChange={(value) => updateConfig(combo, { minStockM: value })} unit="m" /></div><div className="space-y-1"><Label>Modo do piso</Label><Select value={config.floorMode} onValueChange={(value) => updateConfig(combo, { floorMode: value as ArtisanalStrapSourceMode, ...(value === 'buy_ready' ? { purchaseEnabled: true } : {}) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="internal">Produzir internamente</SelectItem><SelectItem value="buy_ready">Comprar pronta</SelectItem></SelectContent></Select></div><label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"><Checkbox checked={config.purchaseEnabled || config.floorMode === 'buy_ready'} disabled={config.floorMode === 'buy_ready'} onCheckedChange={(value) => updateConfig(combo, { purchaseEnabled: value === true })} /><span>Compra pronta habilitada</span></label>{(config.purchaseEnabled || config.floorMode === 'buy_ready') && <><div className="space-y-1"><Label>Fornecedor (opcional)</Label><Select value={config.supplierId || '__none__'} onValueChange={(value) => updateConfig(combo, { supplierId: value === '__none__' ? '' : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">Sem fornecedor · OC provisória</SelectItem>{suppliers.filter((supplier) => supplier.active).map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}</SelectContent></Select><p className="text-[10px] text-muted-foreground">Sem fornecedor, a demanda gera OC provisória e usa 15 dias de lead time.</p></div><div className="space-y-1"><Label>Preço</Label><NumberInput value={config.purchasePrice} onChange={(value) => updateConfig(combo, { purchasePrice: value })} unit="R$/m" /></div><div className="space-y-1"><Label>MOQ</Label><NumberInput value={config.minOrderQuantity} onChange={(value) => updateConfig(combo, { minOrderQuantity: value })} unit="m" /></div><div className="space-y-1"><Label>Múltiplo</Label><NumberInput value={config.purchaseMultiple} onChange={(value) => updateConfig(combo, { purchaseMultiple: value })} unit="m" /></div><div className="space-y-1"><Label>Preparo</Label><NumberInput value={config.preparationDays} onChange={(value) => updateConfig(combo, { preparationDays: value })} unit="dias" /></div></>}</div>}
                  {issue && !existing && <p className="mt-2 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"><Warning className="h-3.5 w-3.5" /> {issue}</p>}
                  {!existing && officialCount === 0 && candidates.length > 0 && (
                    <div className="mt-3 grid gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <div className="space-y-1">
                        <Label>Produto-base oficial *</Label>
                        <Select value={selectedCandidateId} onValueChange={(value) => setCandidateSelections((current) => ({ ...current, [pairKey]: value }))}>
                          <SelectTrigger><SelectValue placeholder="Escolha sem adivinhar" /></SelectTrigger>
                          <SelectContent>{candidates.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!catalog.capabilities.manage_strap_catalog || !selectedCandidateId || !reason.trim() || designateOfficial.isPending}
                        onClick={() => designateOfficial.mutate({
                          baseGroupId: combo.baseGroupId,
                          colorId: combo.colorId,
                          officialProductId: selectedCandidateId,
                          reason: reason.trim(),
                        })}
                      >Designar napa oficial</Button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="space-y-2 rounded-lg border p-3"><label className="flex items-start gap-2 text-sm"><Checkbox checked={floorsConfirmed} onCheckedChange={(value) => setFloorsConfirmed(value === true)} /><span>Revisei e confirmo todos os estoques mínimos e modos de piso, inclusive valores zero.</span></label><div className="space-y-1"><Label>Motivo *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div></div>

          {results.length > 0 && <div className="space-y-1 rounded-lg border p-3"><h3 className="flex items-center gap-2 text-sm font-bold"><CheckCircle className="h-4 w-4" /> Resultado</h3>{results.map((result) => <div key={result.key} className="flex flex-col justify-between gap-1 border-t py-2 text-xs sm:flex-row"><span>{result.label}</span><span className={result.status === 'blocked' ? 'text-destructive' : 'text-muted-foreground'}>{result.status === 'created' ? 'Criada' : result.status === 'skipped' ? 'Pulada' : 'Bloqueada'} · {result.detail}</span></div>)}</div>}

          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button><Button disabled={saving || combos.length === 0 || !floorsConfirmed || !reason.trim()} onClick={run}>{saving ? 'Criando…' : `Criar ${combos.length} combinação(ões)`}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
