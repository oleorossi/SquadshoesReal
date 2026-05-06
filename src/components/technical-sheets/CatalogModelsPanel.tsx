import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Palette, Copy } from 'lucide-react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { toast } from 'sonner';

interface StrapDef {
  id: string;
  label: string;
  group_id?: string;
  group_name?: string;
}

interface StrapAssignment {
  strap_id: string;
  strap_label: string;
  color_id: string;
  color_name: string;
  color_hex?: string;
}

interface CatalogModel {
  id: string;
  sheet_id: string;
  name: string;
  sort_order: number;
  strap_assignments: StrapAssignment[];
  notes: string | null;
}

interface Props {
  sheetId: string;
  strapColors: StrapDef[];
}

export function CatalogModelsPanel({ sheetId, strapColors }: Props) {
  const qc = useQueryClient();
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAssignments, setNewAssignments] = useState<Record<string, { color_id: string; color_name: string; color_hex?: string }>>({});

  // Fetch catalog models for this sheet
  const { data: models = [] } = useQuery({
    queryKey: ['sheet_catalog_models', sheetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sheet_catalog_models')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as CatalogModel[];
    },
  });

  // Fetch colors available for each strap's group
  const groupIds = [...new Set(strapColors.map(s => s.group_id).filter(Boolean))] as string[];
  const { data: groupColorsMap = {} } = useQuery({
    queryKey: ['group_colors_for_catalog', groupIds],
    enabled: groupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_colors')
        .select('group_id, color_id, colors!inner(id, nome, referencia_hex)')
        .in('group_id', groupIds);
      if (error) throw error;
      const map: Record<string, Array<{ id: string; nome: string; hex: string }>> = {};
      (data || []).forEach((gc: any) => {
        if (!map[gc.group_id]) map[gc.group_id] = [];
        map[gc.group_id].push({
          id: gc.colors.id,
          nome: gc.colors.nome,
          hex: gc.colors.referencia_hex || '',
        });
      });
      return map;
    },
  });

  // Also fetch all colors as fallback for straps without group
  const { data: allColors = [] } = useQuery({
    queryKey: ['all_colors_catalog'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('colors')
        .select('id, nome, referencia_hex')
        .eq('status', 'ativo')
        .order('nome');
      if (error) throw error;
      return data || [];
    },
  });

  const addModel = useMutation({
    mutationFn: async (model: { name: string; assignments: StrapAssignment[] }) => {
      const { error } = await supabase.from('sheet_catalog_models').insert({
        sheet_id: sheetId,
        name: model.name,
        sort_order: models.length,
        strap_assignments: model.assignments as any,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sheet_catalog_models', sheetId] });
      toast.success('Modelo de catálogo criado!');
      window.history.back();
      setAddingNew(false);
      setNewName('');
      setNewAssignments({});
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteModel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sheet_catalog_models').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sheet_catalog_models', sheetId] });
      toast.success('Modelo removido');
    },
  });

  const duplicateModel = (model: CatalogModel) => {
    addModel.mutate({
      name: `${model.name} (cópia)`,
      assignments: model.strap_assignments,
    });
  };

  const getColorsForStrap = (strap: StrapDef) => {
    if (strap.group_id && groupColorsMap[strap.group_id]?.length) {
      return groupColorsMap[strap.group_id];
    }
    return allColors.map((c: any) => ({ id: c.id, nome: c.nome, hex: c.referencia_hex || '' }));
  };

  const handleSaveNew = () => {
    if (!newName.trim()) {
      toast.error('Digite um nome para o modelo');
      return;
    }
    const assignments: StrapAssignment[] = strapColors.map(strap => ({
      strap_id: strap.id,
      strap_label: strap.label,
      color_id: newAssignments[strap.id]?.color_id || '',
      color_name: newAssignments[strap.id]?.color_name || '',
      color_hex: newAssignments[strap.id]?.color_hex || '',
    }));
    addModel.mutate({ name: newName, assignments });
  };

  return (
    <div className="space-y-3 mt-4 pt-4 border-t">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">Modelos de Catálogo</h4>
          <Badge variant="secondary" className="text-[10px]">{models.length}</Badge>
        </div>
        {!addingNew && (
          <Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={() => setAddingNew(true)}>
            <Plus className="h-3.5 w-3.5" /> Novo Modelo
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Defina combinações de cores pré-selecionadas para cada tira. Ao criar um pedido de venda, basta selecionar o modelo.
      </p>

      {models.map((model) => (
        <Card key={model.id} className="bg-muted/30">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{model.name}</span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => duplicateModel(model)} title="Duplicar">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <DeleteConfirmButton onConfirm={() => deleteModel.mutate(model.id)} size="icon" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(model.strap_assignments || []).map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs bg-background rounded-md px-2 py-1 border">
                  <span className="font-medium text-muted-foreground">{a.strap_label}:</span>
                  {a.color_hex && (
                    <span
                      className="h-3 w-3 rounded-full border border-border inline-block"
                      style={{ backgroundColor: a.color_hex }}
                    />
                  )}
                  <span className="font-semibold">{a.color_name || '—'}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {addingNew && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3 space-y-3">
            <div>
              <Label className="text-xs">Nome do Modelo</Label>
              <Input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Ex: Modelo 1 - Clássico"
                className="h-8 text-sm mt-1"
              />
            </div>
            <div className="space-y-2">
              {strapColors.map(strap => {
                const colors = getColorsForStrap(strap);
                return (
                  <div key={strap.id} className="flex items-center gap-3">
                    <Badge variant="outline" className="text-[10px] whitespace-nowrap min-w-[60px] justify-center">
                      {strap.label}
                    </Badge>
                    <Select
                      value={newAssignments[strap.id]?.color_id || ''}
                      onValueChange={val => {
                        const color = colors.find(c => c.id === val);
                        setNewAssignments(prev => ({
                          ...prev,
                          [strap.id]: {
                            color_id: val,
                            color_name: color?.nome || '',
                            color_hex: color?.hex || '',
                          },
                        }));
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Selecionar cor..." />
                      </SelectTrigger>
                      <SelectContent>
                        {colors.map(c => (
                          <SelectItem key={c.id} value={c.id} className="text-xs">
                            <div className="flex items-center gap-2">
                              {c.hex && (
                                <span className="h-3 w-3 rounded-full border border-border inline-block" style={{ backgroundColor: c.hex }} />
                              )}
                              {c.nome}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => { setAddingNew(false); setNewName(''); setNewAssignments({}); }}>
                Cancelar
              </Button>
              <Button type="button" size="sm" className="gap-1" onClick={handleSaveNew} disabled={addModel.isPending}>
                <Plus className="h-3.5 w-3.5" /> Salvar Modelo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
