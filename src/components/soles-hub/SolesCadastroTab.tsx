import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FloppyDisk as Save, PencilSimple as Pencil, Gear as Settings2, Stack as Layers, Palette, Link as Link2, Plus, Info, Footprints as Shoe } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { SoleSizeConjugationsEditor } from '@/components/inventory/SoleSizeConjugationsEditor';
import { SoleColorConjugationsEditor } from './SoleColorConjugationsEditor';
import type { SoleProduct } from './types';

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

  // Toggle is_fachetado em todas variantes do grupo
  const updateFachetado = useMutation({
    mutationFn: async (next: boolean) => {
      if (!groupId) {
        const { error } = await supabase
          .from('products')
          .update({ is_fachetado: next } as any)
          .eq('id', sole.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from('products')
        .update({ is_fachetado: next } as any)
        .eq('group_id', groupId);
      if (error) throw error;
    },
    onSuccess: (_data, next) => {
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success(next ? 'Solado marcado como fachetado' : 'Solado não-fachetado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Atualiza sole_classification em TODAS as variantes do grupo (mantém consistência).
  // Se virar palmilha_pronta e ainda não existir regra default de coligação, cria.
  const updateClassification = useMutation({
    mutationFn: async (nextClass: SoleClassification) => {
      if (!groupId) {
        const { error } = await supabase
          .from('products')
          .update({ sole_classification: nextClass } as any)
          .eq('id', sole.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from('products')
        .update({ sole_classification: nextClass } as any)
        .eq('group_id', groupId);
      if (error) throw error;

      if (nextClass === 'palmilha_pronta') {
        const { data: existing } = await (supabase as any)
          .from('sole_color_conjugations')
          .select('id')
          .eq('sole_group_id', groupId)
          .eq('is_default', true)
          .limit(1);
        if (!existing || existing.length === 0) {
          await (supabase as any)
            .from('sole_color_conjugations')
            .insert({
              sole_group_id: groupId,
              cabedal_color: '*',
              palmilha_color: 'Caramelo',
              is_default: true,
            });
        }
      }
    },
    onSuccess: (_data, nextClass) => {
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['sole_color_conjugations'] });
      toast.success(`Tipo alterado pra ${SOLE_CLASSIFICATION_LABEL[nextClass]}`);
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
              <Button
                size="sm"
                onClick={handleSave}
                disabled={update.isPending || Number(form.size_from) > Number(form.size_to)}
                className="gap-1.5"
              >
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
                list="sole-colors-suggestions"
              />
              <datalist id="sole-colors-suggestions">
                {soleColorSuggestions.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Shoe className="h-3 w-3" /> Tipo de solado
              </Label>
              <Select
                value={(sole.sole_classification as SoleClassification | null) || 'tradicional'}
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
              <p className="text-[10px] text-muted-foreground leading-tight">
                {sole.sole_classification === 'palmilha_pronta'
                  ? 'Palmilha já fixada no solado · cor depende do cabedal (ver Coligações)'
                  : sole.sole_classification === 'conjugado'
                  ? 'Algumas numerações compartilham estoque (33/34 etc.)'
                  : 'Cada numeração tem estoque individual'}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Layers className="h-3 w-3" /> Range de numeração
                {groupId && <span className="text-[9px] text-primary uppercase tracking-wider font-bold">· compartilhado</span>}
              </Label>
              {(() => {
                const rangeInvalid = Number(form.size_from) > Number(form.size_to);
                return (
                  <>
                    <div className="flex gap-2 items-center">
                      <Input
                        type="number"
                        min={20}
                        max={50}
                        value={form.size_from}
                        onChange={e => setForm(f => ({ ...f, size_from: Number(e.target.value) }))}
                        disabled={!editing}
                        className={`w-20 ${rangeInvalid ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      />
                      <span className="text-muted-foreground">até</span>
                      <Input
                        type="number"
                        min={20}
                        max={50}
                        value={form.size_to}
                        onChange={e => setForm(f => ({ ...f, size_to: Number(e.target.value) }))}
                        disabled={!editing}
                        className={`w-20 ${rangeInvalid ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      />
                    </div>
                    {rangeInvalid && (
                      <p className="text-[10px] text-destructive">
                        O número inicial não pode ser maior que o final ({form.size_from} &gt; {form.size_to}).
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* GroupBindingFallback é declarado abaixo */}

      {/* Salto Fachetado — toggle global do grupo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Crown className="h-4 w-4 text-primary" />
            Salto Fachetado
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              id="sole-fachetado"
              checked={(sole as any).is_fachetado ?? false}
              onCheckedChange={(v) => updateFachetado.mutate(!!v)}
              disabled={updateFachetado.isPending}
            />
            <Label htmlFor="sole-fachetado" className="text-sm cursor-pointer">
              Solado tem salto fachetado (com forração no salto)
            </Label>
          </div>
          {(sole as any).is_fachetado && (
            <p className="text-[11px] text-muted-foreground">
              Configure o consumo de fachete por numeração na aba <strong>Consumos → Forração/Palmilha</strong>.
              Na ficha técnica só será preenchido o <em>material</em> do fachete.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Conjugações de numeração (só pra 'conjugado') */}
      {sole.sole_classification === 'conjugado' && (
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
              <GroupBindingFallback soleId={sole.id} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Coligações de cor (só pra 'palmilha_pronta') */}
      {sole.sole_classification === 'palmilha_pronta' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" />
              Coligações de cor (cabedal → palmilha)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {groupId ? (
              <SoleColorConjugationsEditor soleGroupId={groupId} />
            ) : (
              <GroupBindingFallback soleId={sole.id} />
            )}
          </CardContent>
        </Card>
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
      const { data, error } = await supabase
        .from('product_groups')
        .select('id, name, description')
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
      <p className="text-[10px] text-muted-foreground">
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
