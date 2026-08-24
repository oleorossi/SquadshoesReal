import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FloppyDisk as Save, Gear as Settings2, Stack as Layers, Palette, Link as Link2, Plus, Info, Footprints as Shoe, Crown, CheckCircle, WarningCircle, Ruler, Truck } from '@phosphor-icons/react';
import { toast } from 'sonner';
// SoleSizeConjugationsEditor removido SÓ desta tela em 2026-05-31.
// Componente continua existindo e é usado em ProductFormDialog +
// VariantListPanel (janela do grupo) + TechnicalSheets — numeração conjugada
// continua ativa no backend.
import { useDisplaySizeKeys } from '@/lib/soleGradeKeys';
import { formatCurrency } from '@/lib/utils';
import { updateSoleProfile } from '@/services/soleProfileService';
import type { SoleProduct } from './types';
import { SoleColorConjugationsEditor } from './SoleColorConjugationsEditor';

type SoleClassification = 'tradicional' | 'palmilha_pronta' | 'conjugado';
const SOLE_CLASSIFICATION_LABEL: Record<SoleClassification, string> = {
  tradicional: 'Tradicional',
  palmilha_pronta: 'Palmilha Pronta',
  conjugado: 'Conjugado',
};

interface Props {
  sole: SoleProduct;
}

export default function SolesCadastroTab({ sole }: Props) {
  const qc = useQueryClient();
  const initialForm = {
    name: sole.name,
    sku: sole.sku || '',
    color: sole.color || '',
    size_from: (sole.stock_grade as any)?._size_from ?? 33,
    size_to: (sole.stock_grade as any)?._size_to ?? 40,
    unit_price: Number(sole.unit_price) || 0,
    supplier_id: sole.supplier_id || '',
    supplier_lead_time_days: Number(sole.supplier_lead_time_days ?? sole.lead_time_days) || 0,
    sole_material: sole.sole_material || '',
    heel_height: Number(sole.heel_height) || 0,
    sole_moq: Number(sole.sole_moq) || 0,
    sole_technical_notes: sole.sole_technical_notes || '',
  };
  const [form, setForm] = useState(initialForm);

  // Conjugações deste solado (ou do grupo, se group_id)
  const groupId = sole.group_id;
  const classification = (sole.sole_classification as SoleClassification | null) || 'tradicional';
  const isFachetado = sole.is_fachetado ?? false;
  const rangeInvalid = Number(form.size_from) < 10
    || Number(form.size_to) > 60
    || Number(form.size_from) > Number(form.size_to);
  // Valor em estoque desta variante = pares em estoque × custo por par.
  // Atualiza ao vivo conforme o usuário edita o "Valor do solado".
  const stockTotalPairs = Number(sole.quantity) || 0;
  const stockValue = stockTotalPairs * (Number(form.unit_price) || 0);
  const isDirty =
    form.name !== initialForm.name ||
    form.sku !== initialForm.sku ||
    form.color !== initialForm.color ||
    Number(form.size_from) !== initialForm.size_from ||
    Number(form.size_to) !== initialForm.size_to ||
    Number(form.unit_price) !== Number(initialForm.unit_price) ||
    form.supplier_id !== initialForm.supplier_id ||
    Number(form.supplier_lead_time_days) !== Number(initialForm.supplier_lead_time_days) ||
    form.sole_material !== initialForm.sole_material ||
    Number(form.heel_height) !== Number(initialForm.heel_height) ||
    Number(form.sole_moq) !== Number(initialForm.sole_moq) ||
    form.sole_technical_notes !== initialForm.sole_technical_notes;

  // Pré-visualização dos tamanhos que vão sair na grade — aplica conjugações
  // se houver (33/34 etc). Mostrado num bloco destacado pro user enxergar o
  // resultado antes de salvar a ficha.
  const baseSizes = useMemo<number[]>(() => {
    const from = Number(form.size_from) || 33;
    const to = Number(form.size_to) || 40;
    if (from > to) return [];
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [form.size_from, form.size_to]);
  const gridKeys = useDisplaySizeKeys({ sizes: baseSizes, soleGroupId: groupId });

  // Prontidão operacional: identificação, custo, integração de compra e ficha.
  const filledSlots = [
    form.name.trim().length > 0,
    form.color.trim().length > 0,
    !rangeInvalid && form.size_from > 0 && form.size_to > 0,
    !!groupId,
    Number(form.unit_price) > 0,
    !!form.supplier_id,
    Number(form.supplier_lead_time_days) > 0,
    form.sole_material.trim().length > 0,
  ];
  const filledCount = filledSlots.filter(Boolean).length;
  const totalSlots = filledSlots.length;
  const progressPct = Math.round((filledCount / totalSlots) * 100);

  // Sugestões de cor: histórico de cores já cadastradas em produtos de solado.
  // Atalho via datalist nativo do browser — evita poluição de dados
  // ("Preto" vs "PRETO" vs "Preto Fosco" criando 3 valores diferentes).
  const { data: soleColorSuggestions = [] } = useQuery({
    queryKey: ['sole_color_suggestions'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('products')
        .select('color')
        .eq('category', 'Solado')
        .not('color', 'is', null)
        .neq('color', '')
        .limit(500);
      const set = new Set<string>();
      for (const r of (data ?? []) as Array<{ color: string }>) {
        const c = (r.color ?? '').trim();
        if (c) set.add(c);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    },
  });

  const update = useMutation({
    mutationFn: () => updateSoleProfile(sole.id, {
      name: form.name.trim(),
      sku: form.sku.trim(),
      color: form.color.trim(),
      unit_price: Number(form.unit_price) || 0,
      size_from: Number(form.size_from),
      size_to: Number(form.size_to),
      supplier_id: form.supplier_id || null,
      supplier_lead_time_days: Number(form.supplier_lead_time_days) || 0,
      sole_material: form.sole_material.trim() || null,
      heel_height: Number(form.heel_height) || 0,
      sole_moq: Number(form.sole_moq) || 0,
      sole_technical_notes: form.sole_technical_notes.trim() || null,
    }),
    onSuccess: ({ siblings_updated: siblingCount }) => {
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      // O range de numeração do solado alimenta a grade do PV e da ficha
      // técnica (SaleOrderItemForm: queries 'sole_size_range_specific' /
      // 'sole_size_conjugations', staleTime 5min, keyed por grupo+material).
      // Sem invalidar, o PV continua mostrando o range ANTIGO após editar
      // (bug 2026-06-10: solado 23–36, mas PV só aparecia até 32).
      qc.invalidateQueries({ queryKey: ['sole_size_range_specific'] });
      qc.invalidateQueries({ queryKey: ['sole_size_conjugations'] });
      if (siblingCount > 0) {
        toast.success(`Cadastro atualizado · propagado para ${siblingCount} ${siblingCount === 1 ? 'cor' : 'cores'} adicionais.`);
      } else {
        toast.success('Cadastro atualizado!');
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Toggle is_fachetado em todas variantes do grupo
  const updateFachetado = useMutation({
    mutationFn: (next: boolean) => updateSoleProfile(sole.id, { is_fachetado: next }),
    onSuccess: (_data, next) => {
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success(next ? 'Solado marcado como fachetado' : 'Solado não-fachetado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers_for_sole_select'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name, lead_time_days')
        .order('name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // === Fachete: material group + dm²/par por numeração ===================
  // Grupos de material disponíveis pra escolher como fachete (forração, sintéticos, etc.).
  const { data: materialGroups = [] } = useQuery({
    queryKey: ['material_groups_for_fachete'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_groups')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    enabled: isFachetado,
  });

  // O consumo do fachete NÃO é lido aqui desde 03/08/2026 — mora em
  // sole_group_standard_items (Consumo Padrão, por modelo). Esta tela guarda só
  // o MATERIAL do fachete, que é cadastro do solado.
  const [facheteForm, setFacheteForm] = useState<{ material_group_id: string | null }>({
    material_group_id: ((sole as any).fachete_material_group_id as string | null) || null,
  });

  const updateFacheteMaterial = useMutation({
    mutationFn: (groupIdSel: string | null) => updateSoleProfile(sole.id, {
      fachete_material_group_id: groupIdSel,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Material do fachete atualizado');
    },
    onError: (e: Error) => toast.error(e.message),
  });


  // Atualiza sole_classification em TODAS as variantes do grupo. A cor não é
  // inferida daqui: criar Caramelo automaticamente quebrava grupos pintáveis.
  const updateClassification = useMutation({
    mutationFn: async (nextClass: SoleClassification) => {
      await updateSoleProfile(sole.id, { sole_classification: nextClass });
    },
    onSuccess: (_data, nextClass) => {
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['sole_color_conjugations'] });
      toast.success(`Tipo alterado pra ${SOLE_CLASSIFICATION_LABEL[nextClass]}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => update.mutate();

  // Helper visual: badge "Preenchido" / "Pendente" pra cabeçalho de card.
  const StatusBadge = ({ filled, label }: { filled: boolean; label?: string }) =>
    filled ? (
      <Badge variant="outline" className="ml-auto bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 gap-1 text-xs font-bold uppercase tracking-wider">
        <CheckCircle className="h-3 w-3" /> {label || 'Preenchido'}
      </Badge>
    ) : (
      <Badge variant="outline" className="ml-auto bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 gap-1 text-xs font-bold uppercase tracking-wider">
        <WarningCircle className="h-3 w-3" /> {label || 'Pendente'}
      </Badge>
    );

  return (
    <div className="space-y-4 pb-24">
      {/* HERO: header com nome + progresso de preenchimento */}
      <div className="rounded-xl border bg-gradient-to-br from-primary/5 via-card to-card p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{form.name || sole.name}</h2>
              <Badge variant="outline" className="text-xs uppercase tracking-wider font-bold">
                {SOLE_CLASSIFICATION_LABEL[classification]}
              </Badge>
              {isFachetado && (
                <Badge variant="outline" className="text-xs uppercase tracking-wider font-bold bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 border-violet-300 dark:border-violet-800 gap-1">
                  <Crown className="h-3 w-3" /> Fachetado
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
              {form.color && <span className="flex items-center gap-1"><Palette className="h-3 w-3" /> {form.color}</span>}
              {form.sku && <span className="font-mono">SKU: {form.sku}</span>}
              <span>{form.size_from}–{form.size_to}</span>
              {groupId && <span className="text-primary font-medium">· Grupo vinculado</span>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Preenchimento</div>
            <div className="text-2xl font-bold tabular-nums">{progressPct}%</div>
            <div className="text-xs text-muted-foreground">{filledCount} de {totalSlots} essenciais</div>
          </div>
        </div>
        {/* Barra de progresso */}
        <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full transition-all ${progressPct === 100 ? 'bg-emerald-500' : progressPct >= 50 ? 'bg-primary' : 'bg-amber-500'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Aviso: o que é compartilhado vs. por cor */}
      {groupId && (
        <Card className="border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/10">
          <CardContent className="py-3 px-4 flex items-start gap-2">
            <Info className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <p>
                <strong>Compartilhado entre cores:</strong> nome, range de numeração, fornecedor, prazo, material, salto, MOQ, observações, consumos e itens padrão.
              </p>
              <p>
                <strong>Por cor:</strong> SKU, cor, preço de compra, estoque por numeração, conjugação cabedal × solado e silk.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 1 — IDENTIFICAÇÃO */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">1. Identificação</CardTitle>
          <StatusBadge filled={form.name.trim().length > 0 && form.color.trim().length > 0} />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                Nome do solado
                {groupId && <span className="text-xs text-primary uppercase tracking-wider font-bold">· compartilhado</span>}
              </Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ex: Saltinho Bloco"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                SKU
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">· por cor</span>
              </Label>
              <Input
                value={form.sku}
                onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                placeholder="—"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Palette className="h-3 w-3" /> Cor
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">· por variante</span>
              </Label>
              <Input
                value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                placeholder="Ex: Preto, Caramelo"
                list="sole-colors-suggestions"
              />
              <datalist id="sole-colors-suggestions">
                {soleColorSuggestions.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                Valor do solado
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">· R$/par · por variante</span>
              </Label>
              {/* CurrencyInput (não <input type=number>): aceita vírgula pt-BR
                  (2,20), seleciona tudo no foco (zero não "gruda") e preserva o
                  texto digitado sem round-trip. (Bug user 2026-06-17.) */}
              <CurrencyInput
                value={Number(form.unit_price) || 0}
                onChange={v => setForm(f => ({ ...f, unit_price: v }))}
              />
              <p className="text-xs text-muted-foreground leading-tight">
                Custo de compra por par. Entra no <strong>valor de estoque</strong> e no <strong>custeio do calçado</strong>.
              </p>
              <div className="mt-1 flex items-center justify-between rounded-md border bg-muted/30 px-2.5 py-1.5">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Valor em estoque</span>
                <span className="text-sm font-mono font-bold tabular-nums">
                  {formatCurrency(stockValue)}
                  <span className="text-xs text-muted-foreground font-normal ml-1.5">· {stockTotalPairs} pares</span>
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Shoe className="h-3 w-3" /> Tipo de solado
              </Label>
              <Select
                value={classification}
                onValueChange={(v) => updateClassification.mutate(v as SoleClassification)}
                disabled={updateClassification.isPending}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tradicional">Tradicional</SelectItem>
                  <SelectItem value="palmilha_pronta">Palmilha Pronta</SelectItem>
                  <SelectItem value="conjugado">Conjugado</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground leading-tight">
                {classification === 'palmilha_pronta'
                  ? 'Palmilha já fixada no solado · cor depende do cabedal (ver Coligações)'
                  : classification === 'conjugado'
                  ? 'Algumas numerações compartilham estoque (33/34 etc.)'
                  : 'Cada numeração tem estoque individual'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2 — NUMERAÇÃO (range + conjugações + prévia da grade) */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">2. Numeração</CardTitle>
          <StatusBadge filled={!rangeInvalid && form.size_from > 0 && form.size_to > 0} />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              Range de numeração
              {groupId && <span className="text-xs text-primary uppercase tracking-wider font-bold">· compartilhado</span>}
            </Label>
            <div className="flex gap-2 items-center">
              <NumberInput
                min={20}
                decimals={0}
                value={form.size_from}
                onChange={n => setForm(f => ({ ...f, size_from: n }))}
                className={`w-20 ${rangeInvalid ? 'border-destructive focus-visible:ring-destructive' : ''}`}
              />
              <span className="text-muted-foreground text-xs">até</span>
              <NumberInput
                min={20}
                decimals={0}
                value={form.size_to}
                onChange={n => setForm(f => ({ ...f, size_to: n }))}
                className={`w-20 ${rangeInvalid ? 'border-destructive focus-visible:ring-destructive' : ''}`}
              />
              {rangeInvalid && (
                <span className="text-xs text-destructive ml-2">
                  Inicial &gt; final ({form.size_from} &gt; {form.size_to})
                </span>
              )}
            </div>
          </div>

          {/* PRÉVIA DA GRADE: bloco destacado mostrando os tamanhos finais */}
          {!rangeInvalid && gridKeys.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-2">
                Grade resultante ({gridKeys.length} numerações)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {gridKeys.map((k) => (
                  <span
                    key={k}
                    className={`h-7 min-w-[34px] px-2 rounded border text-xs font-mono font-bold flex items-center justify-center ${
                      k.includes('/')
                        ? 'bg-primary/10 border-primary/40 text-primary'
                        : 'bg-card border-border text-foreground'
                    }`}
                    title={k.includes('/') ? 'Numeração conjugada' : ''}
                  >
                    {k}
                  </span>
                ))}
              </div>
              {gridKeys.some(k => k.includes('/')) && (
                <p className="text-xs text-muted-foreground mt-2">
                  Numerações em destaque são <strong>conjugadas</strong> (1 par único).
                </p>
              )}
            </div>
          )}

          {/* Bloco "Conjugações de Numeração" REMOVIDO da UI em 2026-05-31
              por pedido do user — só esconde o editor visual aqui em
              /solados → Gestão de Solados. Backend, débito, cálculo de
              consumo e demais UIs (PV, ficha técnica, ProductFormDialog
              em /estoque) continuam funcionando normal com a feature
              de numeração conjugada. Pra editar conjugações use
              /estoque → solado → Editar (ProductFormDialog) ou via
              VariantListPanel (aba Itens da janela do grupo). */}
          {!groupId && classification === 'conjugado' && (
            <div className="rounded-md border bg-muted/20 p-3">
              <GroupBindingFallback soleId={sole.id} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3 — COR DO CABEDAL × COR FÍSICA DO SOLADO */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">3. Cores e pintura</CardTitle>
          <StatusBadge filled={!!groupId} label={groupId ? 'Por grupo' : 'Vincular grupo'} />
        </CardHeader>
        <CardContent>
          {groupId ? (
            <SoleColorConjugationsEditor soleGroupId={groupId} />
          ) : (
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-sm font-medium">Vincule o solado a um grupo para configurar as cores.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                O grupo reúne as variantes físicas Preto, Caramelo e as cores pintáveis usadas no consumo, na compra e na baixa de estoque.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4 — PARÂMETROS INDUSTRIAIS E DE COMPRA */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center gap-2">
          <Ruler className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">4. Engenharia e compra</CardTitle>
          <StatusBadge
            filled={form.sole_material.trim().length > 0 && Number(form.unit_price) > 0}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                Material / composto
                {groupId && <span className="text-primary uppercase tracking-wider font-bold">· compartilhado</span>}
              </Label>
              <Input
                value={form.sole_material}
                onChange={e => setForm(f => ({ ...f, sole_material: e.target.value }))}
                placeholder="PVC, TR, PU, EVA, borracha..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Altura do salto (mm)</Label>
              <NumberInput
                min={0}
                decimals={1}
                value={form.heel_height}
                onChange={n => setForm(f => ({ ...f, heel_height: n }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">MOQ / lote mínimo (pares)</Label>
              <NumberInput
                min={0}
                decimals={0}
                value={form.sole_moq}
                onChange={n => setForm(f => ({ ...f, sole_moq: n }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Observações técnicas</Label>
            <Textarea
              value={form.sole_technical_notes}
              onChange={e => setForm(f => ({ ...f, sole_technical_notes: e.target.value }))}
              placeholder="Fôrma compatível, acabamento, dureza, restrições de aplicação, inspeção de recebimento..."
              rows={3}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Esses dados identificam o composto e orientam compra, inspeção e aplicação. Os consumos por numeração continuam na aba <strong>Consumos</strong>.
          </p>
        </CardContent>
      </Card>

      {/* 4 — CARACTERÍSTICAS (fachetado) */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center gap-2">
          <Crown className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">5. Características</CardTitle>
          <StatusBadge filled label="Configurado" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              id="sole-fachetado"
              checked={isFachetado}
              onCheckedChange={(v) => updateFachetado.mutate(!!v)}
              disabled={updateFachetado.isPending}
            />
            <Label htmlFor="sole-fachetado" className="text-sm cursor-pointer flex-1">
              <span className="font-semibold">Salto fachetado</span>
              <span className="block text-xs text-muted-foreground font-normal">
                Com forração no salto — exige cadastro de consumo de fachete
              </span>
            </Label>
          </div>
          {isFachetado && (
            <div className="rounded-md border border-violet-300/60 bg-violet-50/30 dark:bg-violet-950/10 p-3 space-y-3">
              <p className="text-xs text-violet-900 dark:text-violet-200 leading-relaxed">
                <strong>Salto fachetado ativado.</strong> Escolha aqui o material que reveste o
                fachete. A quantidade consumida por par vira débito automático de estoque quando
                o PV gerar a OP.
              </p>

              {/* Material do fachete */}
              <div>
                <Label className="text-xs uppercase tracking-wider font-bold text-violet-700 dark:text-violet-300">
                  Material do fachete
                </Label>
                <Select
                  value={facheteForm.material_group_id || ''}
                  onValueChange={(v) => {
                    const next = v || null;
                    setFacheteForm(prev => ({ ...prev, material_group_id: next }));
                    updateFacheteMaterial.mutate(next);
                  }}
                >
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue placeholder="Selecionar grupo de material..." />
                  </SelectTrigger>
                  <SelectContent>
                    {materialGroups.map((g: any) => (
                      <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Quando vazio, o sistema cai no <em>lining_material</em> da ficha técnica.
                </p>
              </div>

              {/* Grid dm²/par por numeração saiu em 03/08/2026.
                  Gravava direto em sole_technical_specs — o ESPELHO — então o
                  próximo salvamento em Consumo Padrão apagava sem avisar. O
                  material do fachete continua aqui (é cadastro do solado, não
                  consumo); a quantidade é do MODELO. */}
              <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                O <strong>consumo do fachete</strong> (dm²/par por numeração) é cadastrado em{' '}
                <strong>Consumos → Consumo Padrão</strong>, junto com o resto do consumo deste
                modelo de solado — vale pra todas as cores de uma vez.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CARD: Fornecedor & Lead Time — compartilhado entre cores do grupo */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center gap-2">
          <Truck className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">Fornecedor & Lead Time</CardTitle>
          {form.supplier_id && form.supplier_lead_time_days > 0
            ? <StatusBadge filled label="Configurado" />
            : <StatusBadge filled={false} label="Pendente" />}
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            O lead time entra no <strong>cronograma reverso</strong> do MRP: data-limite de
            compra = entrega do cliente − produção − este lead time. Sem isso, o sistema
            usa o prazo padrão do motor e pode posicionar a compra fora da realidade.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Fornecedor</Label>
              <Select
                value={form.supplier_id || ''}
                onValueChange={(v) => {
                  const sup = (suppliers as any[]).find((s: any) => s.id === v);
                  const inferred = Number(sup?.lead_time_days) || form.supplier_lead_time_days || 0;
                  setForm(prev => ({
                    ...prev,
                    supplier_id: v || '',
                    supplier_lead_time_days: inferred,
                  }));
                }}
              >
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Selecionar fornecedor..." />
                </SelectTrigger>
                <SelectContent>
                  {(suppliers as any[]).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
                Lead time <span className="font-mono">(dias úteis)</span>
              </Label>
              <NumberInput
                min={0}
                decimals={0}
                value={form.supplier_lead_time_days}
                onChange={n => setForm(prev => ({ ...prev, supplier_lead_time_days: n }))}
                className="mt-1 h-9 font-mono text-right"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Coligação de Cor removida da UI em 2026-06-06 pra palmilha_pronta:
          a palmilha vem PRONTA do fornecedor (já paireada com o cabedal pelo
          próprio fornecedor), então não faz sentido o user cadastrar regras
          cabedal→palmilha aqui. O default "* → palmilha padrão" é criado
          automaticamente quando o solado é marcado palmilha_pronta (linha 209),
          e a ficha do operador continua mostrando a palmilha pra conferência. */}
      {classification === 'palmilha_pronta' && (
        <Card className="border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-950/20">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <Palette className="h-4 w-4 text-violet-600" />
            <CardTitle className="text-sm text-violet-900 dark:text-violet-200">Palmilha pronta · sem coligação manual</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-violet-800 dark:text-violet-300 space-y-1.5">
            <p>Esse solado já chega forrado do fornecedor. Não é preciso configurar regra de cor cabedal → palmilha aqui — a parelha vem decidida pelo fornecedor.</p>
            <p className="text-violet-700/80 dark:text-violet-400/80">
              <strong>Ficha do operador</strong>: a palmilha continua sendo listada como item de conferência (cor + numeração) pra o operador validar antes da montagem.
            </p>
          </CardContent>
        </Card>
      )}

      {/* STICKY SAVE BAR — só aparece quando há mudança não salva */}
      {isDirty && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border bg-card shadow-2xl px-4 py-2.5 animate-in slide-in-from-bottom-4">
          <div className="text-xs">
            <span className="font-semibold">Alterações não salvas</span>
            <span className="text-muted-foreground ml-2">no cadastro do solado</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setForm(initialForm)}
            disabled={update.isPending}
          >
            Descartar
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={update.isPending || rangeInvalid || !form.name.trim()}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {update.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state amigável quando o solado não tem `group_id`. Permite vincular a
// um grupo existente OU criar um novo grupo direto da tela, sem mandar o
// usuário pra outra rota.
// ─────────────────────────────────────────────────────────────────────────────
function GroupBindingFallback({ soleId }: { soleId: string }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'idle' | 'pick' | 'create'>('idle');
  const [pickedGroupId, setPickedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['product_groups_for_sole_binding'],
    queryFn: async () => {
      const { data: products, error: productError } = await supabase
        .from('products')
        .select('group_id, category')
        .not('group_id', 'is', null)
        .eq('active', true);
      if (productError) throw productError;
      const soleGroupIds = [...new Set((products || [])
        .filter((product) => {
          const category = (product.category || '').toLowerCase();
          return category === 'sola' || category.startsWith('solado');
        })
        .map(product => product.group_id)
        .filter(Boolean))] as string[];
      if (soleGroupIds.length === 0) return [];

      const { data, error } = await supabase
        .from('product_groups')
        .select('id, name, description')
        .in('id', soleGroupIds)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; description: string | null }>;
    },
    staleTime: 60_000,
  });

  const bind = useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase
        .from('products')
        .update({ group_id: groupId } as any)
        .eq('id', soleId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Solado vinculado ao grupo');
      setMode('idle');
      setPickedGroupId('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createAndBind = useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Nome do grupo é obrigatório');
      const { data: created, error: cErr } = await supabase
        .from('product_groups')
        .insert({ name: trimmed } as any)
        .select('id')
        .single();
      if (cErr) throw cErr;
      const { error: uErr } = await supabase
        .from('products')
        .update({ group_id: (created as any).id } as any)
        .eq('id', soleId);
      if (uErr) throw uErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product_groups_for_sole_binding'] });
      toast.success('Grupo criado e solado vinculado');
      setMode('idle');
      setNewGroupName('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (mode === 'idle') {
    return (
      <div className="text-center py-6">
        <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm font-medium">Solado sem grupo associado</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-md mx-auto">
          Conjugações de numeração (ex.: 33/34) são definidas no nível do grupo. Vincule este solado a um
          grupo pra configurar conjugações e compartilhar specs entre solados similares.
        </p>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <Button size="sm" variant="default" className="gap-1.5" onClick={() => setMode('pick')}>
            <Link2 className="h-3.5 w-3.5" />
            Vincular a grupo existente
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setMode('create')}>
            <Plus className="h-3.5 w-3.5" />
            Criar novo grupo
          </Button>
        </div>
      </div>
    );
  }

  if (mode === 'pick') {
    return (
      <div className="space-y-3 py-2 max-w-md mx-auto">
        <Label className="text-xs">Grupo existente</Label>
        <Select value={pickedGroupId} onValueChange={setPickedGroupId} disabled={isLoading}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder={isLoading ? 'Carregando…' : 'Selecione um grupo'} />
          </SelectTrigger>
          <SelectContent>
            {groups.length === 0 && !isLoading && (
              <SelectItem value="__empty" disabled>Nenhum grupo cadastrado</SelectItem>
            )}
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setMode('idle'); setPickedGroupId(''); }}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => bind.mutate(pickedGroupId)}
            disabled={!pickedGroupId || bind.isPending}
            className="gap-1.5"
          >
            <Link2 className="h-3.5 w-3.5" />
            Vincular
          </Button>
        </div>
      </div>
    );
  }

  // mode === 'create'
  return (
    <div className="space-y-3 py-2 max-w-md mx-auto">
      <Label className="text-xs">Nome do novo grupo</Label>
      <Input
        autoFocus
        value={newGroupName}
        onChange={(e) => setNewGroupName(e.target.value)}
        placeholder="Ex.: Solado Saltinho Bloco"
        className="h-9"
      />
      <p className="text-xs text-muted-foreground">
        O grupo agrupa este solado com outras variantes de cor (ex.: Saltinho Preto, Saltinho Caramelo).
        Conjugações configuradas aqui valem pra todas as variantes.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => { setMode('idle'); setNewGroupName(''); }}>
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={() => createAndBind.mutate(newGroupName)}
          disabled={!newGroupName.trim() || createAndBind.isPending}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Criar e vincular
        </Button>
      </div>
    </div>
  );
}
