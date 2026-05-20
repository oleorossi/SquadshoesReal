import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Plus, PencilSimple as Pencil, Trash as Trash2, Stack as Layers, FileText, Tag, X, Palette } from '@phosphor-icons/react';
import {
  useReferenceMaterialVariants,
  useUpsertReferenceMaterialVariant,
  useDeleteReferenceMaterialVariant,
  ReferenceMaterialVariant,
} from '@/hooks/useReferenceMaterialVariants';

interface Props {
  referenceId: string;
  referenceName?: string;
  referenceNcm?: string | null;
}

const EMPTY_FORM = {
  material_name: '',
  sku: '',
  barcode: '',
  ncm: '',
  description_override: '',
  unit_price_override: '',
  available_colors: [] as string[],
  active: true,
};

type FormState = typeof EMPTY_FORM;

function variantToForm(v: ReferenceMaterialVariant): FormState {
  return {
    material_name: v.material_name,
    sku: v.sku ?? '',
    barcode: v.barcode ?? '',
    ncm: v.ncm ?? '',
    description_override: v.description_override ?? '',
    unit_price_override: v.unit_price_override != null ? String(v.unit_price_override) : '',
    available_colors: v.available_colors ?? [],
    active: v.active,
  };
}

// --- Color tag input ---
function ColorTagInput({
  colors,
  onChange,
}: {
  colors: string[];
  onChange: (colors: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const add = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (!colors.map(c => c.toLowerCase()).includes(trimmed.toLowerCase())) {
      onChange([...colors, trimmed]);
    }
    setInput('');
  };

  const remove = (color: string) => onChange(colors.filter(c => c !== color));

  return (
    <div className="space-y-1">
      <div
        className="flex flex-wrap gap-1 p-2 border rounded-md min-h-[2.5rem] focus-within:ring-1 focus-within:ring-ring cursor-text"
        onClick={() => document.getElementById('color-tag-input')?.focus()}
      >
        {colors.map(c => (
          <span
            key={c}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs border border-primary/20"
          >
            {c}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); remove(c); }}
              className="hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id="color-tag-input"
          className="outline-none text-xs bg-transparent flex-1 min-w-[140px] placeholder:text-muted-foreground"
          placeholder={colors.length === 0 ? 'Ex: Preto, Caramelo, Osso — pressione Enter' : 'Adicionar cor…'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(input);
            } else if (e.key === 'Backspace' && !input && colors.length > 0) {
              remove(colors[colors.length - 1]);
            }
          }}
          onBlur={() => { if (input.trim()) add(input); }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Pressione <kbd className="px-1 rounded bg-muted border text-xs">Enter</kbd> ou vírgula para adicionar cada cor. Backspace remove a última.
      </p>
    </div>
  );
}

interface VariantFormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  referenceId: string;
  editing: ReferenceMaterialVariant | null;
  existingCount: number;
  referenceNcm?: string | null;
  existingVariants: ReferenceMaterialVariant[];
}

function VariantFormDialog({
  open, onOpenChange, referenceId, editing, existingCount, referenceNcm, existingVariants,
}: VariantFormDialogProps) {
  const upsert = useUpsertReferenceMaterialVariant();
  const [form, setForm] = useState<FormState>(editing ? variantToForm(editing) : EMPTY_FORM);

  useEffect(() => {
    setForm(editing ? variantToForm(editing) : EMPTY_FORM);
  }, [editing, open]);

  const set = (field: keyof FormState, value: any) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!form.material_name.trim()) {
      toast.error('Nome do grupo de material é obrigatório');
      return;
    }
    const trimmedSku = form.sku.trim();
    if (trimmedSku) {
      const duplicate = existingVariants.find(
        v => v.sku?.trim().toLowerCase() === trimmedSku.toLowerCase() && v.id !== editing?.id,
      );
      if (duplicate) {
        toast.error(`SKU "${trimmedSku}" já está em uso pelo grupo "${duplicate.material_name}". Use um código único por grupo.`);
        return;
      }
    }
    try {
      await upsert.mutateAsync({
        id: editing?.id,
        reference_id: referenceId,
        material_name: form.material_name.trim(),
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        ncm: form.ncm.trim() || null,
        description_override: form.description_override.trim() || null,
        upper_material_product_id: null,
        unit_price_override: form.unit_price_override !== '' ? Number(form.unit_price_override) : null,
        available_colors: form.available_colors,
        active: form.active,
        display_order: editing?.display_order ?? existingCount,
      });
      toast.success(editing ? 'Grupo de material atualizado' : 'Grupo de material adicionado');
      onOpenChange(false);
    } catch {
      // Error already shown by onError in the mutation
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            {editing ? 'Editar grupo de material' : 'Novo grupo de material'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Nome do grupo de material *</Label>
            <Input
              placeholder="ex: NAPA SANTORINE, NAPA TITANIUM, COURO NATURAL"
              value={form.material_name}
              onChange={e => set('material_name', e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Material principal da sandália — cada grupo terá seu próprio SKU e NCM na NF-e
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold flex items-center gap-1">
                <Tag className="h-3 w-3" /> SKU / Código NF-e
              </Label>
              <Input
                placeholder="ex: REF101-NAPA-SANT"
                value={form.sku}
                onChange={e => set('sku', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Substitui o código da ficha na NF-e</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Código de barras</Label>
              <Input
                placeholder="EAN-13"
                value={form.barcode}
                onChange={e => set('barcode', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">NCM (opcional)</Label>
              <Input
                placeholder={referenceNcm ?? 'Herdado da ficha'}
                value={form.ncm}
                onChange={e => set('ncm', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Deixe em branco para herdar</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Preço unitário (opcional)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Herda do item do pedido"
                value={form.unit_price_override}
                onChange={e => set('unit_price_override', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold flex items-center gap-1">
              <Palette className="h-3 w-3" /> Cores disponíveis neste material
            </Label>
            <ColorTagInput
              colors={form.available_colors}
              onChange={colors => set('available_colors', colors)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold flex items-center gap-1">
              <FileText className="h-3 w-3" /> Descrição NF-e (opcional)
            </Label>
            <Input
              placeholder="ex: Sandália em Napa Santorine - Preto"
              value={form.description_override}
              onChange={e => set('description_override', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Substitui "{`{nome} - {cor}`}" na linha da NF-e</p>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={form.active}
              onCheckedChange={v => set('active', v)}
              id="mat-var-active"
            />
            <Label htmlFor="mat-var-active" className="text-sm cursor-pointer">Grupo ativo</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={upsert.isPending}>
            {upsert.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MaterialVariantsPanel({ referenceId, referenceName, referenceNcm }: Props) {
  const { data: variants = [], isLoading } = useReferenceMaterialVariants(referenceId);
  const deleteVariant = useDeleteReferenceMaterialVariant();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ReferenceMaterialVariant | null>(null);

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (v: ReferenceMaterialVariant) => { setEditing(v); setFormOpen(true); };

  const handleDelete = async (v: ReferenceMaterialVariant) => {
    if (!window.confirm(`Excluir grupo "${v.material_name}"?\n\nAtenção: a operação falhará se pedidos existentes referenciarem este grupo (restrição fiscal).`)) return;
    await deleteVariant.mutateAsync({ id: v.id, referenceId });
    toast.success('Grupo de material excluído');
  };

  const active = variants.filter(v => v.active);
  const inactive = variants.filter(v => !v.active);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Grupos de Material
            {referenceName && <span className="text-sm font-normal text-muted-foreground">— {referenceName}</span>}
          </span>
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> Novo grupo
          </Button>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Defina os grupos de material principal (ex: NAPA SANTORINE, NAPA TITANIUM). Cada grupo tem
          seu próprio SKU e NCM para NF-e, e pode ter cores específicas disponíveis.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {!isLoading && variants.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Nenhum grupo cadastrado. Clique em <strong>Novo grupo</strong> para adicionar.
          </div>
        )}

        {active.length > 0 && (
          <div className="rounded-md border border-border overflow-hidden">
            {active.map((v, idx) => (
              <div
                key={v.id}
                className={`flex items-start gap-3 px-3 py-3 hover:bg-muted/30 transition-colors ${idx < active.length - 1 ? 'border-b border-border/50' : ''}`}
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{v.material_name}</span>
                    {v.sku && (
                      <Badge variant="outline" className="font-mono text-xs">
                        <Tag className="h-3 w-3 mr-1" />{v.sku}
                      </Badge>
                    )}
                    {v.ncm && (
                      <Badge variant="secondary" className="text-xs">NCM: {v.ncm}</Badge>
                    )}
                    {!v.sku && (
                      <Badge variant="destructive" className="text-xs">Sem SKU</Badge>
                    )}
                  </div>
                  {v.available_colors && v.available_colors.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {v.available_colors.map(c => (
                        <span key={c} className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-muted text-xs text-muted-foreground border">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {v.description_override && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <FileText className="h-3 w-3 shrink-0" />
                      {v.description_override}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(v)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={deleteVariant.isPending}
                    onClick={() => handleDelete(v)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {inactive.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">
              {inactive.length} grupo(s) inativo(s)
            </summary>
            <div className="mt-2 rounded-md border border-border/50 overflow-hidden opacity-60">
              {inactive.map((v, idx) => (
                <div
                  key={v.id}
                  className={`flex items-center gap-3 px-3 py-2 ${idx < inactive.length - 1 ? 'border-b border-border/50' : ''}`}
                >
                  <span className="flex-1 line-through">{v.material_name}</span>
                  {v.sku && <Badge variant="outline" className="font-mono text-xs">{v.sku}</Badge>}
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(v)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>

      <VariantFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        referenceId={referenceId}
        editing={editing}
        existingCount={variants.length}
        referenceNcm={referenceNcm}
        existingVariants={variants}
      />
    </Card>
  );
}
