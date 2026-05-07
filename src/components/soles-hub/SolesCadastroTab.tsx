import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Save, Pencil, Settings2, Layers, Palette } from 'lucide-react';
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

  const update = useMutation({
    mutationFn: async (patch: Partial<SoleProduct>) => {
      const { error } = await supabase.from('products').update(patch as any).eq('id', sole.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Cadastro atualizado!');
      setEditing(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateGrade = useMutation({
    mutationFn: async ({ from, to }: { from: number; to: number }) => {
      const grade = { ...(sole.stock_grade as any || {}), _size_from: from, _size_to: to };
      const { error } = await supabase.from('products').update({ stock_grade: grade } as any).eq('id', sole.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Range de numeração atualizado!');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    update.mutate({
      name: form.name,
      sku: form.sku || null,
      color: form.color || null,
    });
    if (form.size_from !== ((sole.stock_grade as any)?._size_from ?? 33) ||
        form.size_to !== ((sole.stock_grade as any)?._size_to ?? 40)) {
      updateGrade.mutate({ from: Number(form.size_from), to: Number(form.size_to) });
    }
  };

  return (
    <div className="space-y-4">
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
              <Label className="text-xs">Nome do solado</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                disabled={!editing}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">SKU</Label>
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
