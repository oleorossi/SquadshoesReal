/**
 * QuickFamilyDialog — atalho pra cadastrar um grupo/linha com variantes de cor
 * em uma única ação.
 *
 * Cenário: usuário quer cadastrar "Tira Chata 10mm" que tem 5 cores. Antes
 * precisava criar 1 grupo no menu de grupos + 5 produtos individuais (cada
 * um com group_id manual). Agora informa nome + cores + supplier e o sistema
 * cria o grupo e depois o lote de produtos. São duas operações; se o lote
 * falhar, o grupo criado nesta tentativa é removido enquanto ainda está vazio.
 *
 * Família técnica e grupo/linha não são sinônimos: este fluxo cria o grupo que
 * recebe os SKUs. A família, quando usada, fica um nível acima na organização.
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NumberInput } from '@/components/ui/number-input';
import { RequiredMark } from '@/components/ui/required-mark';
import { Stack as Layers, Plus, CircleNotch as Loader2, Sparkle as Sparkles } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useProducts } from '@/hooks/useProducts';
import { findDuplicate, type DuplicateHit } from '@/lib/duplicateDetection';
import { DuplicateSuggestion } from './DuplicateSuggestion';
import { useGroups, type ProductGroup } from '@/hooks/useGroups';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useQueryClient } from '@tanstack/react-query';
import { sectorOfGroup, SECTOR_OPTIONS } from '@/lib/categoryFromGroup';
import { ColorsMultiSelect } from '@/components/references/ColorsMultiSelect';
import { createProductsWithStock } from '@/lib/stockCommand';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Pre-seleciona um grupo existente (ex: tabs filtradas) */
  defaultGroupId?: string | null;
}

const AREA_SECTORS = new Set(['Cabedal', 'Palmilha', 'Forração da Palmilha']);
const AREA_STOCK_UNITS = new Set(['m', 'cm', 'dm²']);

function skuToken(value: string, fallback: string): string {
  const token = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return token || fallback;
}

/** Gera SKUs estáveis na ordem das cores. O Set é atualizado a cada item para
 * impedir colisão dentro do próprio lote e já nasce com todos os SKUs do banco. */
function buildUniqueSkus(prefix: string, colors: string[], existingSkus: Array<string | null | undefined>): string[] {
  const visiblePrefix = skuToken(prefix, 'MAT');
  const used = new Set(existingSkus.map(sku => (sku || '').trim().toUpperCase()).filter(Boolean));

  return colors.map((color, index) => {
    const base = `${visiblePrefix}-${skuToken(color, `COR${index + 1}`)}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

function groupNeedsWidth(group: ProductGroup | null | undefined): boolean {
  if (!group) return false;
  return AREA_SECTORS.has(sectorOfGroup(group)) || group.calculation_method === 'meter';
}

function isVariantLineGroup(group: ProductGroup | null | undefined): boolean {
  if (!group) return false;
  return Boolean((group.shared_specs || group.is_bom_color_source) && !group.is_color_agnostic);
}

export function QuickFamilyDialog({ open, onOpenChange, defaultGroupId }: Props) {
  const qc = useQueryClient();
  const { data: groups = [] } = useGroups();
  const { data: suppliers = [] } = useSuppliers();
  const defaultExistingGroupId = defaultGroupId && defaultGroupId !== 'all' ? defaultGroupId : '';

  const [familyName, setFamilyName] = useState('');
  const [skuPrefix, setSkuPrefix] = useState('');
  const [skuPrefixTouched, setSkuPrefixTouched] = useState(false);
  const [groupMode, setGroupMode] = useState<'new' | 'existing'>(defaultExistingGroupId ? 'existing' : 'new');
  const [selectedGroupId, setSelectedGroupId] = useState<string>(defaultExistingGroupId);
  const [newSector, setNewSector] = useState('');
  const [dimensionsWidthMm, setDimensionsWidthMm] = useState(0);
  const [unit, setUnit] = useState('');
  const [unitPrice, setUnitPrice] = useState(0);
  const [supplierId, setSupplierId] = useState<string>('');
  const [supplierLeadDays, setSupplierLeadDays] = useState(10);
  const [colors, setColors] = useState<string[]>(['Preto']);
  // R4.5 — cada cor da fila é checada; a suspeita não entra no insert até ser
  // resolvida, e as demais seguem.
  const { data: todosOsProdutos = [] } = useProducts();
  const [coresLiberadas, setCoresLiberadas] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const selectedGroup = useMemo(
    () => groups.find(group => group.id === selectedGroupId) || null,
    [groups, selectedGroupId],
  );
  const selectedGroupTemplate = useMemo(() => (
    todosOsProdutos.find(product => product.group_id === selectedGroupId && product.active !== false)
    || todosOsProdutos.find(product => product.group_id === selectedGroupId)
    || null
  ), [selectedGroupId, todosOsProdutos]);
  const selectableExistingGroups = useMemo(() => {
    const parentIds = new Set(groups.map(group => group.parent_group_id).filter(Boolean));
    return groups.filter(group => (
      !group.is_family &&
      !parentIds.has(group.id) &&
      isVariantLineGroup(group)
    ));
  }, [groups]);
  const selectedGroupCompatible = Boolean(
    selectedGroup && selectableExistingGroups.some(group => group.id === selectedGroup.id),
  );
  const targetSector = groupMode === 'new'
    ? newSector
    : sectorOfGroup(selectedGroup);
  const targetNeedsWidth = groupMode === 'new'
    ? AREA_SECTORS.has(targetSector)
    : groupNeedsWidth(selectedGroup);
  const targetWidth = groupMode === 'new'
    ? Number(dimensionsWidthMm) || 0
    : Number(selectedGroup?.dimensions_width) || 0;
  const unitIsCompatible = Boolean(unit) && (!targetNeedsWidth || AREA_STOCK_UNITS.has(unit));
  const plannedSkus = useMemo(
    () => buildUniqueSkus(
      skuPrefix || skuToken(familyName, 'MAT'),
      colors,
      todosOsProdutos.map(product => product.sku),
    ),
    [skuPrefix, familyName, colors, todosOsProdutos],
  );

  // O diálogo permanece montado entre trocas de aba. Ao reabrir, sincroniza o
  // grupo sugerido pela aba atual em vez de reutilizar a seleção anterior.
  useEffect(() => {
    if (!open) return;
    setGroupMode(defaultExistingGroupId ? 'existing' : 'new');
    setSelectedGroupId(defaultExistingGroupId);
    setNewSector('');
  }, [open, defaultExistingGroupId]);

  // useGroups pode terminar depois da abertura. Quando o grupo selecionado
  // chega, preenche a identidade da linha sem exigir uma nova seleção manual.
  useEffect(() => {
    if (!open || groupMode !== 'existing' || !selectedGroup) return;
    setFamilyName(selectedGroup.name);
    setSkuPrefix(skuToken(selectedGroup.name, 'MAT'));
    setSkuPrefixTouched(false);
    if (selectedGroupTemplate) {
      setUnit(selectedGroupTemplate.unit || 'un');
      setUnitPrice(Number(selectedGroupTemplate.unit_price) || 0);
      setSupplierId(selectedGroupTemplate.supplier_id || '');
      setSupplierLeadDays(Number(selectedGroupTemplate.supplier_lead_time_days) || 10);
    } else {
      setUnit('');
      setUnitPrice(0);
      setSupplierId('');
      setSupplierLeadDays(10);
    }
  }, [open, groupMode, selectedGroup, selectedGroupTemplate]);

  const reset = () => {
    setFamilyName('');
    setSkuPrefix('');
    setSkuPrefixTouched(false);
    setGroupMode(defaultExistingGroupId ? 'existing' : 'new');
    setSelectedGroupId(defaultExistingGroupId);
    setNewSector('');
    setDimensionsWidthMm(0);
    setUnit('');
    setUnitPrice(0);
    setSupplierId('');
    setSupplierLeadDays(10);
    setColors(['Preto']);
    setCoresLiberadas(new Set());
  };

  const removeColor = (c: string) => {
    setColors(prev => prev.filter(x => x !== c));
  };

  /** Cor da fila que bate com algo já cadastrado e ainda não foi liberada. */
  const suspeitas = useMemo(() => {
    const nome = familyName.trim();
    if (!nome) return [] as { cor: string; hit: DuplicateHit }[];
    const grupoAlvo = groupMode === 'existing' ? selectedGroupId : null;
    return colors
      .filter(c => !coresLiberadas.has(c))
      .map(cor => ({ cor, hit: findDuplicate({ name: nome, color: cor, group_id: grupoAlvo }, todosOsProdutos) }))
      .filter((x): x is { cor: string; hit: DuplicateHit } => x.hit != null);
  }, [colors, familyName, groupMode, selectedGroupId, todosOsProdutos, coresLiberadas]);

  const handleSubmit = async () => {
    if (!familyName.trim()) { toast.error('Nome do grupo/linha é obrigatório'); return; }
    if (colors.length === 0) { toast.error('Adicione ao menos 1 cor'); return; }
    if (groupMode === 'new' && !newSector) { toast.error('Selecione o setor / aplicação do material'); return; }
    if (!unit) { toast.error('Selecione a unidade-base de estoque e consumo'); return; }
    if (!unitIsCompatible) {
      toast.error('Materiais de área/lineares devem usar metro, centímetro ou dm² como unidade-base. Revise o item-modelo antes de adicionar variantes.');
      return;
    }
    if (groupMode === 'existing' && !selectedGroup) { toast.error('Selecione uma linha de variantes válida'); return; }
    if (groupMode === 'existing' && !selectedGroupCompatible) {
      toast.error('Este grupo não é uma linha de variantes válida. Revise sua organização antes de adicionar cores.');
      return;
    }
    if (suspeitas.length > 0) { toast.error('Resolva as cores marcadas como possíveis duplicatas'); return; }
    if (targetNeedsWidth && targetWidth <= 0) {
      toast.error(groupMode === 'new'
        ? 'Informe a largura útil em mm antes de criar variantes de ' + targetSector + '.'
        : 'Este grupo linear/de área está sem largura. Edite o grupo e preencha Dimensões → Largura útil antes de adicionar variantes.');
      return;
    }

    setSubmitting(true);
    let createdGroupId: string | null = null;
    let productBatchCompleted = false;

    try {
      // 1) Garante o grupo. Quando o INSERT realmente cria uma linha, guardamos
      // somente aquele ID para uma eventual compensação — grupo preexistente
      // nunca entra no cleanup.
      let resolvedGroup: ProductGroup | null = null;

      if (groupMode === 'new') {
        const sector = targetSector;
        // is_family ainda pertence à migration compartilhada e pode não estar na
        // versão gerada do client local.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newGroup, error: groupError } = await (supabase as any)
          .from('product_groups')
          .insert({
            name: familyName.trim(),
            description: 'Grupo/linha ' + familyName.trim() + ' — criado via cadastro rápido de variantes',
            sector,
            is_family: false,
            shared_specs: true,
            // Linha com variantes nasce com uma unidade técnica explícita.
            // Sem isso o editor recebia shared_specs=true + unidade NULL e o
            // save posterior tentava apagar a unidade-base dos produtos.
            consumption_unit: unit,
            ...(AREA_SECTORS.has(sector)
              ? { dimensions_width: dimensionsWidthMm, dimensions_unit: 'mm' }
              : {}),
          })
          .select('*')
          .single();

        if (groupError) {
          if (groupError.code === '23505') {
            throw new Error('Já existe um grupo com este nome. Troque para “Adicionar a grupo existente” e selecione a linha correta.');
          }
          throw new Error('Falha ao criar grupo: ' + groupError.message);
        }
        if (!newGroup?.id) throw new Error('O grupo foi criado sem retornar um identificador.');
        resolvedGroup = newGroup as ProductGroup;
        createdGroupId = newGroup.id;
      } else {
        resolvedGroup = selectedGroup;
        if (!resolvedGroup) throw new Error('O grupo selecionado não está mais disponível. Atualize a tela e tente novamente.');
      }

      const resolvedWidth = Number(resolvedGroup.dimensions_width) || 0;
      if (groupNeedsWidth(resolvedGroup) && resolvedWidth <= 0) {
        throw new Error(
          'Este grupo linear/de área está sem largura. Edite o grupo e preencha Dimensões → Largura útil antes de adicionar variantes.',
        );
      }

      // 2) Cria uma linha por cor. Dimensões vêm do ProductGroup, a mesma fonte
      // que alimenta a ficha de componente e a conversão de área.
      const category = sectorOfGroup(resolvedGroup);
      const calculationMethod = unit === 'm' || unit === 'cm'
        ? 'meter'
        : unit === 'kg'
          ? 'weight'
          : 'unit';
      const rows = colors.map((color, index) => ({
        purchase_unit: unit,
        production_unit: unit,
        purchase_order_unit: unit,
        conversion_rate: 1,
        calculation_method: calculationMethod,
        ...(groupMode === 'existing' && selectedGroupTemplate ? {
          technical_name: selectedGroupTemplate.technical_name || '',
          min_stock: Number(selectedGroupTemplate.min_stock) || 0,
          max_stock: Number(selectedGroupTemplate.max_stock) || 0,
          safety_stock: Number(selectedGroupTemplate.safety_stock) || 0,
          location: selectedGroupTemplate.location || '',
          yield_per_meter: selectedGroupTemplate.yield_per_meter ?? null,
          yield_unit: selectedGroupTemplate.yield_unit || null,
          purchase_unit: selectedGroupTemplate.purchase_unit || selectedGroupTemplate.unit || 'un',
          production_unit: selectedGroupTemplate.production_unit || selectedGroupTemplate.unit || 'un',
          conversion_rate: Number(selectedGroupTemplate.conversion_rate) > 0 ? Number(selectedGroupTemplate.conversion_rate) : 1,
          purchase_order_unit: selectedGroupTemplate.purchase_order_unit || selectedGroupTemplate.purchase_unit || selectedGroupTemplate.unit || 'un',
          min_order_quantity: Number(selectedGroupTemplate.min_order_quantity) || 0,
          lead_time_days: Number(selectedGroupTemplate.lead_time_days) || 0,
          calculation_method: selectedGroupTemplate.calculation_method || 'weight',
          price_wholesale: Number(selectedGroupTemplate.price_wholesale) || 0,
          price_retail: Number(selectedGroupTemplate.price_retail) || 0,
          pairs_per_package: Number(selectedGroupTemplate.pairs_per_package) || 1,
        } : {}),
        name: familyName.trim() + ' - ' + color,
        sku: plannedSkus[index],
        color,
        category,
        group_id: resolvedGroup.id,
        unit,
        unit_price: unitPrice,
        supplier_id: supplierId || null,
        supplier_lead_time_days: supplierLeadDays,
        active: true,
        dimensions_length: Number(resolvedGroup.dimensions_length) || 0,
        dimensions_width: resolvedWidth,
        dimensions_thickness: Number(resolvedGroup.dimensions_thickness) || 0,
        dimensions_unit: resolvedGroup.dimensions_unit || 'mm',
      }));

      const created = await createProductsWithStock(rows.map((row) => ({
        ...row,
        quantity: 0,
        reason: 'Cadastro rapido de variante sem saldo inicial',
      })));
      if (!created.success) {
        const code = created.errors?.[0]?.error;
        if (code === 'SKU_ALREADY_EXISTS') {
          throw new Error('Um SKU ou uma cor foi cadastrado por outra operação. Tente novamente para recalcular os sufixos.');
        }
        throw new Error('Falha ao criar produtos: ' + (code || 'erro desconhecido'));
      }
      const createdProducts = created.results ?? [];
      productBatchCompleted = true;

      toast.success((createdProducts?.length || 0) + ' variante(s) criada(s) no grupo "' + familyName + '"');
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product_groups'] });
      reset();
      onOpenChange(false);
    } catch (error) {
      let cleanupFailure: string | null = null;

      if (createdGroupId && !productBatchCompleted) {
        // A RPC trava o grupo e revalida o vazio na mesma transação. Um
        // COUNT+DELETE em duas requisições poderia desagrupar produto concorrente
        // por causa do FK ON DELETE SET NULL.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: removed, error: cleanupError } = await (supabase as any)
          .rpc('delete_empty_material_group', { p_group_id: createdGroupId });
        if (cleanupError) {
          cleanupFailure = 'não foi possível compensar o grupo novo: ' + cleanupError.message;
        } else if (!removed) {
          cleanupFailure = 'o grupo novo não foi removido porque já recebeu itens ou subgrupos';
        }
      }

      const message = error instanceof Error ? error.message : 'Erro inesperado';
      console.error('[QuickFamilyDialog] erro:', error);
      if (cleanupFailure) {
        console.error('[QuickFamilyDialog] erro de compensação:', {
          groupId: createdGroupId,
          message: cleanupFailure,
        });
      }
      toast.error(cleanupFailure ? message + ' Falha no cleanup: ' + cleanupFailure + '.' : message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Cadastro rápido — grupo com variantes
          </DialogTitle>
          <DialogDescription>
            Crie uma linha comercial/técnica e depois seus SKUs de cor em um fluxo guiado. Se o lote falhar, o grupo novo ainda vazio é removido por compensação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* ── Grupo / linha ── */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Layers className="h-3.5 w-3.5" /> Grupo / linha
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <Label htmlFor="fam-name" className="text-xs">Nome do grupo / linha <RequiredMark /></Label>
                <Input
                  id="fam-name"
                  value={familyName}
                  onChange={e => {
                    const nextName = e.target.value;
                    setFamilyName(nextName);
                    if (!skuPrefixTouched) setSkuPrefix(skuToken(nextName, ''));
                  }}
                  className="mt-1 h-10"
                  placeholder="Ex: Tira Chata 10mm"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Cada produto cadastrado vai usar este nome + a cor (ex: "Tira Chata 10mm - Preto")
                </p>
              </div>

              <div>
                <Label htmlFor="fam-sku-prefix" className="text-xs">Prefixo do SKU</Label>
                <Input
                  id="fam-sku-prefix"
                  value={skuPrefix}
                  onChange={e => {
                    setSkuPrefixTouched(true);
                    setSkuPrefix(e.target.value.toUpperCase());
                  }}
                  className="mt-1 h-10 font-mono"
                  placeholder="TIRA"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Primeiro SKU disponível: <span className="font-mono">{plannedSkus[0] || '—'}</span>
                </p>
              </div>

              <div>
                <Label className="text-xs">Onde criar?</Label>
                <Select value={groupMode} onValueChange={value => setGroupMode(value as 'new' | 'existing')}>
                  <SelectTrigger className="mt-1 h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Criar novo grupo / linha</SelectItem>
                    <SelectItem value="existing">Adicionar a grupo existente</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {groupMode === 'new' && (
                <div className="md:col-span-2">
                  <Label className="text-xs">Setor / aplicação <RequiredMark /></Label>
                  <Select value={newSector} onValueChange={(value) => {
                    setNewSector(value);
                    if (AREA_SECTORS.has(value) && unit && !AREA_STOCK_UNITS.has(unit)) setUnit('');
                  }}>
                    <SelectTrigger className="mt-1 h-10"><SelectValue placeholder="Selecione onde o material é aplicado…" /></SelectTrigger>
                    <SelectContent>
                      {SECTOR_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Define onde o material é aplicado; a família técnica é organizada separadamente.
                  </p>
                </div>
              )}

              {groupMode === 'existing' && (
                <div className="md:col-span-2">
                  <Label className="text-xs">Grupo existente <RequiredMark /></Label>
                  <Select value={selectedGroupId} onValueChange={(value) => {
                    setSelectedGroupId(value);
                    const selectedGroup = groups.find((group) => group.id === value);
                    if (selectedGroup) {
                      setFamilyName(selectedGroup.name);
                      setSkuPrefix(skuToken(selectedGroup.name, 'MAT'));
                      setSkuPrefixTouched(false);
                    }
                  }}>
                    <SelectTrigger className="mt-1 h-10"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {selectedGroup && !selectedGroupCompatible && (
                        <SelectItem value={selectedGroup.id} disabled>
                          {selectedGroup.name} — converter na edição do grupo
                        </SelectItem>
                      )}
                      {selectableExistingGroups.map(group => (
                        <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedGroup && !selectedGroupCompatible && (
                    <p className="mt-1 text-xs text-warning">
                      Este grupo é uma família, grupo-pai ou coleção sem modelo de variantes. Revise-o antes de continuar.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Cores ── */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Plus className="h-3.5 w-3.5" /> Cores ({colors.length})
            </div>

            <ColorsMultiSelect
              value={colors.join(', ')}
              onChange={(value) => setColors(value.split(',').map((color) => color.trim()).filter(Boolean))}
              excluded={groupMode === 'existing'
                ? todosOsProdutos.filter((product) => product.group_id === selectedGroupId).map((product) => product.color || '')
                : []}
              placeholder="Buscar no catálogo ou cadastrar cor…"
            />

            {/* Uma sugestão por vez — a primeira cor suspeita da fila (R4.5). */}
            {suspeitas[0] && (
              <DuplicateSuggestion
                hit={suspeitas[0].hit}
                onSameProduct={() => removeColor(suspeitas[0].cor)}
                onDifferent={() => setCoresLiberadas(prev => new Set(prev).add(suspeitas[0].cor))}
              />
            )}

            <p className="text-xs text-muted-foreground">
              Serão criados <span className="font-bold text-primary">{colors.length} SKU(s)</span> — um por cor, todos vinculados ao mesmo grupo/linha.
            </p>
          </div>

          {/* ── Especificações padrão (aplicadas a todas as cores) ── */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Especificações padrão
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Unidade-base <RequiredMark /></Label>
                <Select
                  value={unit}
                  onValueChange={setUnit}
                  disabled={groupMode === 'existing' && Boolean(selectedGroupTemplate)}
                >
                  <SelectTrigger className="mt-1 h-10"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="m">Metro</SelectItem>
                    <SelectItem value="cm">Centímetro</SelectItem>
                    <SelectItem value="dm²">dm²</SelectItem>
                    {!targetNeedsWidth && <SelectItem value="un">Unidade</SelectItem>}
                    {!targetNeedsWidth && <SelectItem value="par">Par</SelectItem>}
                    {!targetNeedsWidth && <SelectItem value="kg">Quilograma</SelectItem>}
                  </SelectContent>
                </Select>
                {groupMode === 'existing' && selectedGroupTemplate && (
                  <p className="mt-1 text-xs text-muted-foreground">Herdada do item-modelo da linha.</p>
                )}
                {!unitIsCompatible && unit && (
                  <p className="mt-1 text-xs text-destructive">Unidade incompatível com material de área/linear.</p>
                )}
              </div>
              <div>
                <Label className="text-xs">Preço unitário (R$)</Label>
                <NumberInput value={unitPrice} onChange={setUnitPrice} min={0} step="0.01" className="mt-1 h-10" />
              </div>
              <div>
                <Label className="text-xs">Lead time fornecedor (dias)</Label>
                <NumberInput value={supplierLeadDays} onChange={setSupplierLeadDays} min={1} step="1" className="mt-1 h-10" />
              </div>
              {targetNeedsWidth && (
                <div className="md:col-span-3">
                  <Label className="text-xs">
                    Largura útil do material {groupMode === 'new' ? '(mm)' : '(definida no grupo)'}
                    {groupMode === 'new' && <RequiredMark />}
                  </Label>
                  {groupMode === 'new' ? (
                    <NumberInput
                      value={dimensionsWidthMm}
                      onChange={setDimensionsWidthMm}
                      min={0}
                      step="0.1"
                      className="mt-1 h-10"
                    />
                  ) : (
                    <div className="mt-1 flex h-10 items-center rounded-md border border-border bg-muted/30 px-3 font-mono text-sm">
                      {targetWidth > 0
                        ? `${targetWidth} ${selectedGroup?.dimensions_unit || 'mm'}`
                        : 'Não cadastrada'}
                    </div>
                  )}
                  <p className={targetWidth > 0 ? 'mt-1 text-xs text-muted-foreground' : 'mt-1 text-xs text-warning'}>
                    {groupMode === 'new'
                      ? `Obrigatória para ${targetSector}; será gravada no grupo em milímetros e herdada por todas as cores.`
                      : targetWidth > 0
                        ? 'A largura vem do ProductGroup e será herdada por todas as novas variantes.'
                        : 'Antes de continuar, abra o grupo, acesse Dimensões e preencha Largura útil.'}
                  </p>
                </div>
              )}
              <div className="md:col-span-3">
                <Label className="text-xs">Fornecedor</Label>
                <Select value={supplierId || '__none__'} onValueChange={v => setSupplierId(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="mt-1 h-10"><SelectValue placeholder="Sem fornecedor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem fornecedor</SelectItem>
                    {suppliers.filter(s => s.active).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.trade_name || s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-3 border-t">
          <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              submitting ||
              !familyName.trim() ||
              colors.length === 0 ||
              (groupMode === 'new' && !newSector) ||
              !unitIsCompatible ||
              (groupMode === 'existing' && !selectedGroupCompatible) ||
              (targetNeedsWidth && targetWidth <= 0)
            }
            className="gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar {colors.length} variante{colors.length !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
