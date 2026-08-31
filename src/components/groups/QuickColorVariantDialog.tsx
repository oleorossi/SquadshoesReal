import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  CircleNotch as Loader2,
  Copy,
  Palette,
  Ruler,
  WarningCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { RequiredMark } from '@/components/ui/required-mark';
import { useColors } from '@/hooks/useColors';
import type { ProductGroup } from '@/hooks/useGroups';
import type { Product } from '@/types/inventory';
import { supabase } from '@/integrations/supabase/client';
import {
  createQuickGroupVariant,
  formatQuickVariantColor,
  normalizeQuickVariantColor,
  type QuickGroupVariantResult,
} from '@/lib/quickGroupVariant';

interface Props {
  group: ProductGroup;
  template: Product | null;
  products: Product[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (result: QuickGroupVariantResult) => void;
}

const money = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
}).format(value || 0);

function dimensionsSummary(group: ProductGroup, template: Product): { label: string; source: string } {
  const usesGroupGeometry = Number(group.dimensions_width) > 0;
  const length = usesGroupGeometry
    ? Number(group.dimensions_length) || 0
    : Number(template.dimensions_length) || 0;
  const width = usesGroupGeometry
    ? Number(group.dimensions_width) || 0
    : Number(template.dimensions_width) || 0;
  const thickness = usesGroupGeometry
    ? Number(group.dimensions_thickness) || 0
    : Number(template.dimensions_thickness) || 0;
  const unit = usesGroupGeometry
    ? group.dimensions_unit || 'mm'
    : template.dimensions_unit || 'mm';
  const parts = [length, width, thickness].filter(value => value > 0);
  return {
    label: parts.length > 0
      ? `${parts.map(value => value.toLocaleString('pt-BR')).join(' × ')} ${unit}`
      : 'Não informadas',
    source: usesGroupGeometry ? 'grupo de material' : 'item-modelo',
  };
}

export default function QuickColorVariantDialog({
  group,
  template,
  products,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const queryClient = useQueryClient();
  const { data: catalogColors = [] } = useColors();
  const [color, setColor] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [unitPrice, setUnitPrice] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const requestIdRef = useRef<string | null>(null);

  const {
    data: templateSheet,
    isLoading: sheetLoading,
    isError: sheetError,
    refetch: refetchTemplateSheet,
  } = useQuery({
    queryKey: ['quick_variant_template_sheet', template?.id],
    enabled: open && !!template?.id,
    queryFn: async () => {
      if (!template?.id) return null;
      const { data, error } = await supabase
        .from('component_sheets')
        .select('id, dimensions_length, dimensions_width, dimensions_thickness, dimensions_unit, yield_per_size, yield_per_sole, default_sole_group_id, notes')
        .eq('product_id', template.id)
        .maybeSingle();
      if (error) throw error;
      return data as {
        id: string;
        yield_per_size: Record<string, unknown> | null;
        yield_per_sole: Record<string, unknown> | null;
        default_sole_group_id: string | null;
        notes: string | null;
      } | null;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    setColor('');
    setQuantity(0);
    // O usuário redigita o custo e confirma que bate com o modelo. Isso evita
    // aceitar um preço herdado sem que ele tenha sido conferido.
    setUnitPrice(0);
    setConfirmed(false);
    setFormError('');
    requestIdRef.current = null;
  }, [open, template?.id]);

  const existingColors = useMemo(
    () => new Set(products.map(product => normalizeQuickVariantColor(product.color || '')).filter(Boolean)),
    [products],
  );
  const normalizedColor = normalizeQuickVariantColor(color);
  const formattedColor = formatQuickVariantColor(color);
  const duplicateColor = Boolean(normalizedColor && existingColors.has(normalizedColor));
  const standardPrice = Number(template?.unit_price) || 0;
  const samePrice = Boolean(template)
    && Math.abs(Number(unitPrice) - standardPrice) < 0.0000005;
  const validNumbers = Number.isFinite(quantity) && quantity >= 0
    && Number.isFinite(unitPrice) && unitPrice >= 0;
  const canSubmit = Boolean(
    template
    && !sheetLoading
    && !sheetError
    && normalizedColor
    && !duplicateColor
    && validNumbers
    && samePrice
    && confirmed
    && !submitting,
  );

  const handlePriceChange = (value: number) => {
    setUnitPrice(value);
    setConfirmed(false);
    setFormError('');
    requestIdRef.current = null;
  };
  const handleColorChange = (value: string) => {
    setColor(value);
    setConfirmed(false);
    setFormError('');
    requestIdRef.current = null;
  };

  const handleSubmit = async () => {
    if (!template || !canSubmit) return;
    const requestId = requestIdRef.current || globalThis.crypto?.randomUUID?.();
    if (!requestId) {
      setFormError('O navegador não oferece uma identificação segura para esta operação.');
      return;
    }
    requestIdRef.current = requestId;
    setSubmitting(true);
    setFormError('');
    try {
      const result = await createQuickGroupVariant({
        groupId: group.id,
        templateProductId: template.id,
        color: formattedColor,
        quantity,
        unitPrice,
        requestId,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['component_sheets'] }),
        queryClient.invalidateQueries({ queryKey: ['component_sheets_by_product', group.id] }),
        queryClient.invalidateQueries({ queryKey: ['quick_variant_group_sheets', group.id] }),
        queryClient.invalidateQueries({ queryKey: ['group_stock_rollups'] }),
      ]);
      toast.success(`Variação ${result.color} criada`, {
        description: `Saldo inicial: ${quantity.toLocaleString('pt-BR')} ${template.unit || ''} · ${money(unitPrice)} por ${template.unit || 'unidade'}.`,
      });
      onCreated?.(result);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível criar a variação.';
      setFormError(message);
      toast.error('Variação não criada', { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" />
            Nova variação · {group.name}
          </DialogTitle>
          <DialogDescription>
            Informe somente a nova cor, o saldo inicial e o mesmo valor unitário do item-modelo.
          </DialogDescription>
        </DialogHeader>

        {!template ? (
          <div className="border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            Escolha o ícone “Usar como modelo” em uma das linhas do grupo.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="border-l-2 border-primary bg-primary/5 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Item-modelo</p>
                  <p className="truncate text-sm font-semibold">{template.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{template.sku || 'Sem SKU'} · {template.color || 'Sem cor'}</p>
                </div>
                <Badge variant="outline" className="font-mono text-xs">{template.unit || '—'}</Badge>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="border border-foreground/15 bg-muted/20 px-3 py-2">
                <p className="flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <Ruler className="h-3.5 w-3.5" /> Dimensões herdadas
                </p>
                <p className="mt-1 text-sm font-semibold">{dimensionsSummary(group, template).label}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">Fonte: {dimensionsSummary(group, template).source}</p>
              </div>
              <div className="border border-foreground/15 bg-muted/20 px-3 py-2">
                <p className="flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <Copy className="h-3.5 w-3.5" /> Padrões herdados
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {sheetLoading
                    ? 'Verificando ficha…'
                    : sheetError
                      ? 'Falha ao verificar a ficha'
                      : templateSheet ? 'Ficha técnica do modelo' : 'Metadados do modelo'}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {sheetError
                    ? 'A criação fica bloqueada até confirmar os padrões do modelo.'
                    : templateSheet
                      ? 'Rendimentos, notas e solado padrão serão copiados.'
                      : 'O modelo não possui ficha de componente; nenhuma regra será inventada.'}
                </p>
                {sheetError && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="mt-1 h-auto p-0 text-[10px]"
                    onClick={() => refetchTemplateSheet()}
                  >
                    Tentar novamente
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="quick-variant-color" className="text-xs">Nome da nova cor <RequiredMark /></Label>
                <Input
                  id="quick-variant-color"
                  list="quick-variant-color-catalog"
                  autoFocus
                  value={color}
                  onChange={event => handleColorChange(event.target.value)}
                  onBlur={() => setColor(formattedColor)}
                  className="mt-1 h-10 uppercase"
                  placeholder="Ex.: AZUL MARINHO"
                  aria-invalid={duplicateColor}
                />
                <datalist id="quick-variant-color-catalog">
                  {catalogColors.map(item => <option key={item.id} value={item.nome} />)}
                </datalist>
                {duplicateColor && <p className="mt-1 text-xs text-destructive">Esta cor já existe no grupo.</p>}
              </div>

              <div>
                <Label htmlFor="quick-variant-quantity" className="text-xs">Quantidade inicial <RequiredMark /></Label>
                <NumberInput
                  id="quick-variant-quantity"
                  value={quantity}
                  onChange={(value) => {
                    setQuantity(value);
                    setFormError('');
                    requestIdRef.current = null;
                  }}
                  min={0}
                  unit={template.unit || undefined}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="quick-variant-price" className="text-xs">Valor unitário <RequiredMark /></Label>
                <CurrencyInput
                  id="quick-variant-price"
                  value={unitPrice}
                  onChange={handlePriceChange}
                  className="mt-1"
                />
                <p className={`mt-1 text-[11px] ${unitPrice > 0 && !samePrice ? 'text-destructive' : 'text-muted-foreground'}`}>
                  Digite o padrão do modelo: <strong>{money(standardPrice)}</strong>/{template.unit || 'un'}.
                </p>
              </div>
            </div>

            <label className={`flex items-start gap-2 border px-3 py-2.5 ${samePrice ? 'border-success/30 bg-success/5' : 'border-foreground/15 bg-muted/20'}`}>
              <Checkbox
                checked={confirmed}
                disabled={!samePrice || submitting}
                onCheckedChange={(checked) => setConfirmed(checked === true)}
                aria-invalid={!confirmed}
                className="mt-0.5"
              />
              <span className="text-xs leading-relaxed">
                <strong>Confirmo que o valor unitário é o mesmo padrão das demais cores:</strong>{' '}
                {money(standardPrice)} por {template.unit || 'unidade'}.
              </span>
            </label>

            {formError && (
              <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
                <WarningCircle className="mt-0.5 h-4 w-4 shrink-0" weight="fill" />
                {formError}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" className="gap-1.5" disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Criar variação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
