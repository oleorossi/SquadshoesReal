import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

/**
 * Cadastro COMPLETO de uma caixa (`box_types`) — porta ÚNICA.
 *
 * Decisão do dono (02/08/2026): embalagem passa a ser cadastrada também pela
 * tela do solado, com medidas/preço/estoque. Pra não repetir o padrão de "dois
 * editores do mesmo dado" (que já custou caro em grupos de estoque e no consumo
 * de solado), o formulário mora AQUI e é montado nos dois lugares:
 *
 *   • Gestão de Embalagens → Cadastro & Estoque  (`PackagingStockPanel`)
 *   • Solados → Consumos → Embalagem             (`SolePackagingPanel`)
 *
 * Corrigir um campo aqui corrige nos dois. Não recriar um segundo formulário.
 */

export type BoxKind = 'individual' | 'master' | 'colmeia' | 'fitilho';

export const KIND_LABEL: Record<BoxKind, string> = {
  individual: 'Individual',
  master: 'Master',
  colmeia: 'Colmeia',
  fitilho: 'Fitilho',
};

export const KIND_HELPER: Record<BoxKind, string> = {
  individual: '1 par por caixa. Vai dentro da master ou amarrada com fitilho.',
  master: 'Agrupa N pares (típico 12). Na NF: 1 master = 1 volume.',
  colmeia: 'Carrega N pares diretamente. Na NF: 1 colmeia = 1 volume.',
  fitilho: 'Material linear (metros) que amarra individuais. Na NF: cada par é 1 volume.',
};

export interface BoxRow {
  id: string;
  nome: string;
  tipo: BoxKind | null;
  interno?: boolean;
  pairs_per_box_default: number | null;
  metros_per_amarrado_default: number | null;
  comprimento_cm: number;
  largura_cm: number;
  altura_cm: number;
  peso_kg: number | null;
  /** Tara da caixa vazia em KG — fonte do peso bruto da NF (Σ caixas × tara). */
  empty_weight_kg: number | null;
  empilhamento_maximo: number | null;
  quantity: number;
  min_stock: number;
  unit_price: number;
  supplier_id: string | null;
  active?: boolean;
  suppliers?: { id: string; name: string } | null;
}

export interface BoxFormState {
  nome: string;
  tipo: BoxKind;
  pairs_per_box_default: number;
  metros_per_amarrado_default: number;
  comprimento_cm: number;
  largura_cm: number;
  altura_cm: number;
  peso_kg: number;
  empty_weight_kg: number;
  empilhamento_maximo: number;
  quantity: number;
  min_stock: number;
  unit_price: number;
  supplier_id: string;
}

export const emptyBoxForm: BoxFormState = {
  nome: '',
  tipo: 'individual',
  pairs_per_box_default: 1,
  metros_per_amarrado_default: 1,
  comprimento_cm: 0,
  largura_cm: 0,
  altura_cm: 0,
  peso_kg: 0,
  empty_weight_kg: 0,
  empilhamento_maximo: 0,
  quantity: 0,
  min_stock: 0,
  unit_price: 0,
  supplier_id: '',
};

export function boxToForm(b: BoxRow): BoxFormState {
  return {
    nome: b.nome,
    tipo: (b.tipo || (b.interno ? 'individual' : 'master')) as BoxKind,
    pairs_per_box_default: Number(b.pairs_per_box_default ?? (b.interno ? 1 : 12)),
    metros_per_amarrado_default: Number(b.metros_per_amarrado_default ?? 1),
    comprimento_cm: Number(b.comprimento_cm || 0),
    largura_cm: Number(b.largura_cm || 0),
    altura_cm: Number(b.altura_cm || 0),
    peso_kg: Number(b.peso_kg || 0),
    empty_weight_kg: Number(b.empty_weight_kg || 0),
    empilhamento_maximo: Number(b.empilhamento_maximo || 0),
    quantity: Number(b.quantity || 0),
    min_stock: Number(b.min_stock || 0),
    unit_price: Number(b.unit_price || 0),
    supplier_id: b.supplier_id || '',
  };
}

/** Invalida TODAS as chaves que leem caixa — a lista de embalagens, os
 *  seletores do solado, os cards de estatística e os alertas. */
export function invalidateBoxQueries(qc: ReturnType<typeof useQueryClient>) {
  for (const key of [
    'box_types_stock', 'box_types', 'box_types_with_kind', 'individualPackaging',
    'packagingStats', 'packagingAlerts', 'sole_packaging', 'packaging_links_overview_by_sole',
  ]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null/undefined = criar nova. Preenchido = editar. */
  box?: BoxRow | null;
  /** Pré-seleciona o tipo ao criar (a tela do solado abre já no slot certo). */
  defaultTipo?: BoxKind;
  /** Recebe o id da caixa salva — a tela do solado usa pra já vincular no slot. */
  onSaved?: (boxId: string) => void;
}

export function BoxTypeFormDialog({ open, onOpenChange, box, defaultTipo, onSaved }: Props) {
  const qc = useQueryClient();
  const isEdit = !!box;
  const [form, setForm] = useState<BoxFormState>(emptyBoxForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(box ? boxToForm(box) : { ...emptyBoxForm, tipo: defaultTipo ?? 'individual', pairs_per_box_default: defaultTipo === 'individual' || !defaultTipo ? 1 : 12 });
  }, [open, box, defaultTipo]);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers_for_packaging'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string }>;
    },
    staleTime: 60_000,
  });

  const handleSave = async () => {
    if (!form.nome.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    setSaving(true);
    try {
      // `interno` espelha tipo='individual' por compat com leitores antigos.
      // `empty_weight_kg` entra também na CRIAÇÃO — antes só era gravado na
      // edição, então caixa nova nascia sem tara e o peso bruto da NF saía
      // errado até alguém reabrir e salvar de novo.
      const payload = {
        nome: form.nome.trim(),
        tipo: form.tipo,
        interno: form.tipo === 'individual',
        pairs_per_box_default: form.pairs_per_box_default,
        metros_per_amarrado_default: form.tipo === 'fitilho' ? form.metros_per_amarrado_default : null,
        comprimento_cm: form.comprimento_cm,
        largura_cm: form.largura_cm,
        altura_cm: form.altura_cm,
        peso_kg: form.peso_kg,
        empty_weight_kg: form.empty_weight_kg || null,
        empilhamento_maximo: form.empilhamento_maximo || null,
        quantity: form.quantity,
        min_stock: form.min_stock,
        unit_price: form.unit_price,
        supplier_id: form.supplier_id || null,
      };

      if (isEdit && box) {
        const prevQty = Number(box.quantity || 0);
        const { error } = await (supabase as any)
          .from('box_types')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', box.id);
        if (error) throw error;

        const diff = Math.abs(form.quantity - prevQty);
        if (diff > 0) {
          await supabase.from('stock_movements').insert({
            product_id: box.id,
            movement_type: form.quantity > prevQty ? 'in' : 'out',
            quantity: diff,
            previous_stock: prevQty,
            new_stock: form.quantity,
            description: 'Ajuste manual de estoque de embalagem',
          });
        }
        toast.success('Embalagem atualizada!');
        invalidateBoxQueries(qc);
        onSaved?.(box.id);
      } else {
        const { data: created, error } = await (supabase as any)
          .from('box_types')
          .insert({ ...payload, active: true })
          .select('id')
          .single();
        if (error) throw error;

        if (form.quantity > 0 && created?.id) {
          await supabase.from('stock_movements').insert({
            product_id: created.id,
            movement_type: 'in',
            quantity: form.quantity,
            previous_stock: 0,
            new_stock: form.quantity,
            description: 'Estoque inicial de embalagem',
          });
        }
        toast.success('Embalagem criada!');
        invalidateBoxQueries(qc);
        if (created?.id) onSaved?.(created.id);
      }
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao salvar embalagem');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar ${box?.nome}` : 'Nova embalagem'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Caixa Master 12P"
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select
                value={form.tipo}
                onValueChange={(v: BoxKind) =>
                  setForm((f) => ({
                    ...f,
                    tipo: v,
                    // sugere capacidade típica do tipo (usuário sobrescreve)
                    pairs_per_box_default: v === 'individual' ? 1 : 12,
                  }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Individual — 1 par</SelectItem>
                  <SelectItem value="master">Master — agrupa N pares (NF: 1 master = 1 volume)</SelectItem>
                  <SelectItem value="colmeia">Colmeia — carrega N pares direto (NF: 1 colmeia = 1 volume)</SelectItem>
                  <SelectItem value="fitilho">Fitilho — material linear (NF: cada par = 1 volume)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">{KIND_HELPER[form.tipo]}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{form.tipo === 'fitilho' ? 'Pares por amarrado' : 'Pares por caixa'}</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.pairs_per_box_default || ''}
                  onChange={(e) => setForm((f) => ({ ...f, pairs_per_box_default: Number(e.target.value) }))}
                />
              </div>
              {form.tipo === 'fitilho' && (
                <div>
                  <Label>Metros por amarrado</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min={0.1}
                    value={form.metros_per_amarrado_default || ''}
                    onChange={(e) => setForm((f) => ({ ...f, metros_per_amarrado_default: Number(e.target.value) }))}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Quantos metros de fitilho cada amarrado consome. É aqui que esse número mora — o solado não o sobrescreve.
                  </p>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>Comp. (cm)</Label>
                <Input
                  type="number"
                  value={form.comprimento_cm || ''}
                  onChange={(e) => setForm((f) => ({ ...f, comprimento_cm: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Label>Larg. (cm)</Label>
                <Input
                  type="number"
                  value={form.largura_cm || ''}
                  onChange={(e) => setForm((f) => ({ ...f, largura_cm: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Label>Alt. (cm)</Label>
                <Input
                  type="number"
                  value={form.altura_cm || ''}
                  onChange={(e) => setForm((f) => ({ ...f, altura_cm: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Peso (g)</Label>
                <Input
                  type="number"
                  value={form.peso_kg || ''}
                  onChange={(e) => setForm((f) => ({ ...f, peso_kg: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Label>Tara — caixa vazia (kg)</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={form.empty_weight_kg || ''}
                  onChange={(e) => setForm((f) => ({ ...f, empty_weight_kg: Number(e.target.value) }))}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Peso da caixa vazia em kg. Usado no peso bruto da NF-e (peso líquido + nº de caixas × tara).
                </p>
              </div>
              <div>
                <Label>Empilhamento</Label>
                <Input
                  type="number"
                  value={form.empilhamento_maximo || ''}
                  onChange={(e) => setForm((f) => ({ ...f, empilhamento_maximo: Number(e.target.value) }))}
                  placeholder="Níveis"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Estoque Atual</Label>
                <Input
                  type="number"
                  value={form.quantity || ''}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Label>Estoque Mínimo</Label>
                <Input
                  type="number"
                  value={form.min_stock || ''}
                  onChange={(e) => setForm((f) => ({ ...f, min_stock: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div>
              <Label>Custo Unitário (R$)</Label>
              <Input
                type="number"
                step="0.0001"
                value={form.unit_price || ''}
                onChange={(e) => setForm((f) => ({ ...f, unit_price: Number(e.target.value) }))}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Entra no custeio do pedido. Caixa com preço 0 zera o custo de embalagem.
              </p>
            </div>
            <div>
              <Label>Fornecedor</Label>
              <Select
                value={form.supplier_id}
                onValueChange={(v) => setForm((f) => ({ ...f, supplier_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar..." />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar embalagem'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BoxTypeFormDialog;
