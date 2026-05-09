import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Save, Pencil, Settings2, Layers, Palette, Info } from 'lucide-react';
import { toast } from 'sonner';
import { SoleSizeConjugationsEditor } from '@/components/inventory/SoleSizeConjugationsEditor';
import type { SoleProduct } from './types';

interface Props {
  sole: SoleProduct;
}

export default function SolesCadastroTab({ sole }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: sole.name,
    sku: sole.sku || '',
    color: sole.color || '',
    size_from: (sole.stock_grade as any)?._size_from ?? 33,
    size_to: (sole.stock_grade as any)?._size_to ?? 40,
    notes: '',
  });

  // Conjugações deste solado (ou do grupo, se group_id)
  const groupId = sole.group_id;

  /**
   * Decisão de modelagem (Squad Shoes, mai/2026):
   * Cor de solado é variante de ESTOQUE/EXPEDIÇÃO, não de tecnologia.
   * Tudo que é técnico (nome, range de numeração, conjugação, consumo,
   * itens padrão) é COMPARTILHADO entre cores do mesmo solado.
   * Por isso ao salvar, replicamos pras siblings (mesmo group_id).
   *
   * O que NÃO replica:
   *   - cor (óbvio)
   *   - sku   (cada variante tem SKU próprio, ex: SOL01-PRT vs SOL01-CAR)
   *   - quantity / stock_grade qty (estoque por cor)
   *
   * O que REPLICA:
   *   - name (mesmo modelo de solado)
   *   - stock_grade _size_from / _size_to (range de numeração)
   */
  const replicateToSiblings = async (patch: { name?: string; gradeRange?: { from: number; to: number } }) => {
    if (!groupId) return { count: 0 }; // sem group_id = sem siblings
    const { data: siblings } = await supabase
      .from('products')
      .select('id, stock_grade')
      .eq('group_id', groupId)
      .neq('id', sole.id);

    let count = 0;
    for (const sib of (siblings || [])) {
      const updates: any = {};
      if (patch.name !== undefined) updates.name = patch.name;
      if (patch.gradeRange) {
        const grade = { ...(sib.stock_grade as any || {}), _size_from: patch.gradeRange.from, _size_to: patch.gradeRange.to };
        updates.stock_grade = grade;
      }
      if (Object.keys(updates).length === 0) continue;
      const { error } = await supabase.from('products').update(updates).eq('id', sib.id);
      if (!error) count++;
    }
    return { count };
  };

  const update = useMutation({
    mutationFn: async (patch: { name: string; sku: string | null; color: string | null; gradeRange?: { from: number; to: number } }) => {
      // 1. Atualiza o produto selecionado (todos os campos)
      const updates: any = {
        name: patch.name,
        sku: patch.sku,
        color: patch.color,
      };
      if (patch.gradeRange) {
        const grade = { ...(sole.stock_grade as any || {}), _size_from: patch.gradeRange.from, _size_to: patch.gradeRange.to };
        updates.stock_grade = grade;
      }
      const { error } = await supabase.from('products').update(updates).eq('id', sole.id);
      if (error) throw error;

      // 2. Replica name + gradeRange pras siblings (cor diferente, mesmo modelo)
      const nameChanged = patch.name !== sole.name;
      const rangeChanged = !!patch.gradeRange;
      let siblingCount = 0;
      if (nameChanged || rangeChanged) {
        const result = await replicateToSiblings({
          name: nameChanged ? patch.name : undefined,
          gradeRange: patch.gradeRange,
        });
        siblingCount = result.count;
      }
      return { siblingCount };
    },
    onSuccess: ({ siblingCount }) => {
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      if (siblingCount > 0) {
        toast.success(`Cadastro atualizado · propagado para ${siblingCount} ${siblingCount === 1 ? 'cor' : 'cores'} adicionais.`);
      } else {
        toast.success('Cadastro atualizado!');
      }
      setEditing(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    const currentFrom = (sole.stock_grade as any)?._size_from ?? 33;
    const currentTo = (sole.stock_grade as any)?._size_to ?? 40;
    const rangeChanged = form.size_from !== currentFrom || form.size_to !== currentTo;

    update.mutate({
      name: form.name,
      sku: form.sku || null,
      color: form.color || null,
      gradeRange: rangeChanged ? { from: Number(form.size_from), to: Number(form.size_to) } : undefined,
    });
  };

  return (
    <div className="space-y-4">
      {/* Aviso: o que é compartilhado vs. por cor */}
      {groupId && (
        <Card className="border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/10">
          <CardContent className="py-3 px-4 flex items-start gap-2">
            <Info className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <p>
                <strong>O que é compartilhado entre cores:</strong> nome, range de numeração,
                conjugações (33/34, 39/40), consumo de Forração/Palmilha e Itens Padrão.
                Editar aqui propaga automaticamente.
              </p>
              <p>
                <strong>O que fica por cor:</strong> SKU, estoque por numeração e a conjugação
                cabedal × solado (silk também — artes mudam por cor).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cadastro básico */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" /> Dados básicos
          </CardTitle>
          {!editing ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="gap-1.5">
              <Pencil className="h-3 w-3" /> Editar
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setForm({
                name: sole.name, sku: sole.sku || '', color: sole.color || '',
                size_from: (sole.stock_grade as any)?._size_from ?? 33,
                size_to: (sole.stock_grade as any)?._size_to ?? 40,
                notes: '',
              }); }}>Cancelar</Button>
              <Button size="sm" onClick={handleSave} disabled={update.isPending} className="gap-1.5">
                <Save className="h-3 w-3" /> Salvar
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                Nome do solado
                {groupId && <span className="text-[9px] text-primary uppercase tracking-wider font-bold">· compartilhado</span>}
              </Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                disabled={!editing}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                SKU
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">· por cor</span>
              </Label>
              <Input
                value={form.sku}
                onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                disabled={!editing}
                placeholder="—"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Palette className="h-3 w-3" /> Cor
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">· por variante</span>
              </Label>
              <Input
                value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                disabled={!editing}
                placeholder="—"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Layers className="h-3 w-3" /> Range de numeração
                {groupId && <span className="text-[9px] text-primary uppercase tracking-wider font-bold">· compartilhado</span>}
              </Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  min={20}
                  max={50}
                  value={form.size_from}
                  onChange={e => setForm(f => ({ ...f, size_from: Number(e.target.value) }))}
                  disabled={!editing}
                  className="w-20"
                />
                <span className="text-muted-foreground">até</span>
                <Input
                  type="number"
                  min={20}
                  max={50}
                  value={form.size_to}
                  onChange={e => setForm(f => ({ ...f, size_to: Number(e.target.value) }))}
                  disabled={!editing}
                  className="w-20"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conjugações */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Conjugações de numeração
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Quando duas numerações compartilham estoque (ex.: 33/34, 39/40), defina aqui.
            O estoque, a venda e o consumo respeitam a conjugação automaticamente.
          </p>
        </CardHeader>
        <CardContent>
          {groupId ? (
            <SoleSizeConjugationsEditor
              soleGroupId={groupId}
              sizeFrom={Number(form.size_from) || 33}
              sizeTo={Number(form.size_to) || 40}
            />
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Solado sem grupo associado.</p>
              <p className="text-xs mt-1">Conjugações são definidas no nível do grupo de produtos. Vincule este solado a um grupo no cadastro principal.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
