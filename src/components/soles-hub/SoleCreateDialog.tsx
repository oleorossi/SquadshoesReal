import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { CircleNotch as Loader2, Plus, WarningCircle, Check, X } from '@phosphor-icons/react';
import { toast } from 'sonner';

type SoleClassification = 'tradicional' | 'palmilha_pronta' | 'conjugado';

const SOLE_CLASSIFICATION_OPTIONS: { value: SoleClassification; label: string; hint: string }[] = [
  { value: 'tradicional',     label: 'Tradicional',     hint: 'Solado padrão sem palmilha integrada' },
  { value: 'palmilha_pronta', label: 'Palmilha Pronta', hint: 'Solado já vem com a palmilha forrada do fornecedor' },
  { value: 'conjugado',       label: 'Conjugado',       hint: 'Numerações compartilham forma (ex: 23/24)' },
];

function slugSku(s: string): string {
  return s.normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 10);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Callback ao criar com sucesso — recebe o id do novo solado pra auto-seleção. */
  onCreated?: (newSoleId: string) => void;
}

export default function SoleCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [sku, setSku] = useState('');
  const [sizeFrom, setSizeFrom] = useState<number>(33);
  const [sizeTo, setSizeTo] = useState<number>(40);
  const [classification, setClassification] = useState<SoleClassification>('tradicional');
  const [isFachetado, setIsFachetado] = useState(false);
  const [minStock, setMinStock] = useState<number>(0);
  const [groupId, setGroupId] = useState<string>('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [notes, setNotes] = useState('');

  // Sugestões pra autocomplete (cores já cadastradas em outros solados)
  const { data: colorSuggestions = [] } = useQuery({
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
    enabled: open,
  });

  // Grupos existentes (apenas os usados por solados pra não poluir a lista)
  const { data: soleGroups = [] } = useQuery({
    queryKey: ['sole_groups_for_create'],
    queryFn: async () => {
      const { data: prods } = await (supabase as any)
        .from('products')
        .select('group_id')
        .eq('category', 'Solado')
        .not('group_id', 'is', null);
      const groupIds = Array.from(new Set((prods ?? []).map((p: any) => p.group_id))).filter(Boolean);
      if (groupIds.length === 0) return [];
      const { data: groups } = await (supabase as any)
        .from('product_groups')
        .select('id, name')
        .in('id', groupIds)
        .order('name');
      return (groups ?? []) as Array<{ id: string; name: string }>;
    },
    enabled: open,
  });

  const rangeInvalid = sizeFrom > sizeTo || sizeFrom < 10 || sizeTo > 60;
  const nameInvalid = name.trim().length < 2;
  const canSubmit = !nameInvalid && !rangeInvalid;

  // SKU sugerido — atualiza enquanto user digita (só se ainda não tocou no SKU)
  const suggestedSku = useMemo(() => {
    if (!name.trim()) return '';
    const base = slugSku(name);
    const colorSlug = color.trim() ? slugSku(color) : '';
    return colorSlug ? `${base}-${colorSlug}` : base;
  }, [name, color]);
  const effectiveSku = sku.trim() || suggestedSku;

  const reset = () => {
    setName(''); setColor(''); setSku('');
    setSizeFrom(33); setSizeTo(40);
    setClassification('tradicional');
    setIsFachetado(false);
    setMinStock(0);
    setGroupId('');
    setCreatingGroup(false);
    setNewGroupName('');
    setNotes('');
  };

  // Cria nova família de solado on-the-fly e seleciona-a no form.
  // Schema product_groups: só 'name' é obrigatório — resto tem default.
  const createGroup = useMutation({
    mutationFn: async () => {
      const trimmed = newGroupName.trim();
      if (trimmed.length < 2) throw new Error('Nome da família precisa ter no mínimo 2 caracteres.');
      const { data, error } = await (supabase as any)
        .from('product_groups')
        .insert({ name: trimmed })
        .select('id, name')
        .single();
      if (error) {
        if (error.code === '23505') {
          throw new Error(`Família "${trimmed}" já existe — selecione na lista.`);
        }
        throw error;
      }
      return data as { id: string; name: string };
    },
    onSuccess: (newGroup) => {
      toast.success(`Família "${newGroup.name}" criada.`);
      qc.invalidateQueries({ queryKey: ['sole_groups_for_create'] });
      qc.invalidateQueries({ queryKey: ['product_groups'] });
      setGroupId(newGroup.id);
      setCreatingGroup(false);
      setNewGroupName('');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Erro ao criar família');
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      // Stock grade inicial: todas as numerações zeradas + meta _size_from/_size_to.
      // Padrão usado em todo o app (SolesCadastroTab read this same shape).
      const grade: Record<string, any> = { _size_from: sizeFrom, _size_to: sizeTo };
      for (let s = sizeFrom; s <= sizeTo; s++) {
        grade[String(s)] = 0;
      }

      const payload = {
        name: name.trim(),
        sku: effectiveSku,
        color: color.trim() || '',
        category: 'Solado',
        unit: 'par',
        quantity: 0,
        min_stock: minStock || 0,
        active: true,
        unit_price: 0,
        stock_grade: grade,
        sole_classification: classification,
        is_fachetado: isFachetado,
        group_id: groupId || null,
        sole_technical_notes: notes.trim() || null,
      };

      const { data, error } = await (supabase as any)
        .from('products')
        .insert(payload)
        .select('id')
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error(`SKU "${effectiveSku}" já existe. Use outro nome ou cor.`);
        }
        throw error;
      }
      return data?.id as string;
    },
    onSuccess: (newId) => {
      toast.success(`Solado "${name}" cadastrado.`);
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['sole_color_suggestions'] });
      onCreated?.(newId);
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Erro ao cadastrar solado');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) reset();
      onOpenChange(v);
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Novo Solado
          </DialogTitle>
          <DialogDescription>
            Cadastre um solado novo. Estoque inicial fica zerado em todas as numerações.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nome */}
          <div className="space-y-1.5">
            <Label htmlFor="sole-name">Nome do solado *</Label>
            <Input
              id="sole-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Ex: "Antares", "Bloco Alto"'
              autoFocus
            />
            {nameInvalid && name.length > 0 && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <WarningCircle className="h-3 w-3" /> Mínimo 2 caracteres
              </p>
            )}
          </div>

          {/* Cor + SKU lado a lado */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sole-color">Cor</Label>
              <Input
                id="sole-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="Preto, Bege..."
                list="sole-color-suggestions"
              />
              <datalist id="sole-color-suggestions">
                {colorSuggestions.map((c: string) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sole-sku">SKU</Label>
              <Input
                id="sole-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder={suggestedSku || 'auto'}
                className="font-mono text-xs"
              />
            </div>
          </div>

          {/* Numeração de/até */}
          <div className="space-y-1.5">
            <Label>Numeração</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number" min={10} max={60}
                value={sizeFrom}
                onChange={(e) => setSizeFrom(Number(e.target.value) || 33)}
                className="w-20 font-mono"
              />
              <span className="text-sm text-muted-foreground">até</span>
              <Input
                type="number" min={10} max={60}
                value={sizeTo}
                onChange={(e) => setSizeTo(Number(e.target.value) || 40)}
                className="w-20 font-mono"
              />
              <span className="text-xs text-muted-foreground ml-2">
                {!rangeInvalid && `${sizeTo - sizeFrom + 1} numerações`}
              </span>
            </div>
            {rangeInvalid && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <WarningCircle className="h-3 w-3" /> Faixa inválida (mín 10, máx 60, de ≤ até)
              </p>
            )}
          </div>

          {/* Classificação + Fachetado */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sole-classification">Classificação</Label>
              <Select value={classification} onValueChange={(v) => setClassification(v as SoleClassification)}>
                <SelectTrigger id="sole-classification">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOLE_CLASSIFICATION_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.hint}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sole-fachetado" className="block">Fachetado</Label>
              <div className="flex items-center gap-2 h-9">
                <Switch
                  id="sole-fachetado"
                  checked={isFachetado}
                  onCheckedChange={setIsFachetado}
                />
                <span className="text-sm text-muted-foreground">
                  {isFachetado ? 'Com forração extra' : 'Sem forração extra'}
                </span>
              </div>
            </div>
          </div>

          {/* Estoque mínimo + grupo */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sole-min-stock">Estoque mínimo</Label>
              <Input
                id="sole-min-stock"
                type="number" min={0}
                value={minStock}
                onChange={(e) => setMinStock(Number(e.target.value) || 0)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sole-group">Família (opcional)</Label>
              {creatingGroup ? (
                <div className="flex gap-1">
                  <Input
                    id="sole-group-new"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (newGroupName.trim().length >= 2 && !createGroup.isPending) createGroup.mutate();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setCreatingGroup(false);
                        setNewGroupName('');
                      }
                    }}
                    placeholder="Nome da nova família"
                    autoFocus
                    disabled={createGroup.isPending}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="default"
                    onClick={() => createGroup.mutate()}
                    disabled={newGroupName.trim().length < 2 || createGroup.isPending}
                    aria-label="Criar família"
                    className="shrink-0"
                  >
                    {createGroup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => { setCreatingGroup(false); setNewGroupName(''); }}
                    disabled={createGroup.isPending}
                    aria-label="Cancelar"
                    className="shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Select
                  value={groupId || 'none'}
                  onValueChange={(v) => {
                    if (v === '__new__') {
                      setCreatingGroup(true);
                      return;
                    }
                    setGroupId(v === 'none' ? '' : v);
                  }}
                >
                  <SelectTrigger id="sole-group">
                    <SelectValue placeholder="Sem família" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem família</SelectItem>
                    {soleGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                    ))}
                    <SelectItem value="__new__" className="text-primary font-semibold">
                      + Criar nova família...
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Notas técnicas */}
          <div className="space-y-1.5">
            <Label htmlFor="sole-notes">Observações técnicas (opcional)</Label>
            <Input
              id="sole-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder='Ex: "altura 3cm, salto bloco"'
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit || create.isPending}>
              {create.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cadastrando...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Cadastrar Solado
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
