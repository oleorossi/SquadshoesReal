/**
 * QuickFamilyDialog — atalho pra cadastrar uma "família com variações de cor"
 * em uma única ação.
 *
 * Cenário: usuário quer cadastrar "Tira Chata 10mm" que tem 5 cores. Antes
 * precisava criar 1 grupo no menu de grupos + 5 produtos individuais (cada
 * um com group_id manual). Agora informa nome + cores + supplier e o sistema
 * cria grupo + N produtos atomicamente.
 *
 * O conceito de "grupo" continua existindo no schema (sem ele, MRP/débito/
 * fichas técnicas não funcionam), mas pro usuário fica simples: "família de
 * tira chata" em vez de "grupo + 5 produtos".
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NumberInput } from '@/components/ui/number-input';
import { Stack as Layers, Plus, X, CircleNotch as Loader2, Sparkle as Sparkles } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useGroups } from '@/hooks/useGroups';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Pre-seleciona um grupo existente (ex: tabs filtradas) */
  defaultGroupId?: string | null;
}

const COMMON_COLORS = ['Preto', 'Branco', 'Bege', 'Caramelo', 'Café', 'Marrom', 'Cinza', 'Vermelho', 'Azul', 'Verde'];

function slugForSku(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);
}

export function QuickFamilyDialog({ open, onOpenChange, defaultGroupId }: Props) {
  const qc = useQueryClient();
  const { data: groups = [] } = useGroups();
  const { data: suppliers = [] } = useSuppliers();

  const [familyName, setFamilyName] = useState('');
  const [skuPrefix, setSkuPrefix] = useState('');
  const [groupMode, setGroupMode] = useState<'new' | 'existing'>('new');
  const [selectedGroupId, setSelectedGroupId] = useState<string>(defaultGroupId || '');
  const [unit, setUnit] = useState('un');
  const [unitPrice, setUnitPrice] = useState(0);
  const [supplierId, setSupplierId] = useState<string>('');
  const [supplierLeadDays, setSupplierLeadDays] = useState(10);
  const [colors, setColors] = useState<string[]>(['Preto']);
  const [colorInput, setColorInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setFamilyName('');
    setSkuPrefix('');
    setGroupMode('new');
    setSelectedGroupId(defaultGroupId || '');
    setUnit('un');
    setUnitPrice(0);
    setSupplierId('');
    setSupplierLeadDays(10);
    setColors(['Preto']);
    setColorInput('');
  };

  const addColor = (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    if (colors.some(x => x.toLowerCase() === c.toLowerCase())) return;
    setColors(prev => [...prev, c]);
    setColorInput('');
  };

  const removeColor = (c: string) => {
    setColors(prev => prev.filter(x => x !== c));
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addColor(colorInput);
    }
  };

  const handleSubmit = async () => {
    // Validações
    if (!familyName.trim()) { toast.error('Nome da família é obrigatório'); return; }
    if (colors.length === 0) { toast.error('Adicione ao menos 1 cor'); return; }
    if (groupMode === 'existing' && !selectedGroupId) { toast.error('Selecione um grupo'); return; }

    setSubmitting(true);
    try {
      // 1) Garantir grupo: cria novo OU usa existente
      let groupId: string;
      if (groupMode === 'new') {
        const { data: newGroup, error: gErr } = await (supabase as any)
          .from('product_groups')
          .insert({ name: familyName.trim(), description: `Família de ${familyName.trim()} — criada via Cadastro Rápido` })
          .select('id')
          .single();
        if (gErr) {
          if (gErr.code === '23505') {
            // Já existe — busca e usa
            const { data: existing } = await (supabase as any)
              .from('product_groups')
              .select('id')
              .eq('name', familyName.trim())
              .single();
            if (!existing) throw new Error(`Falha ao criar grupo: ${gErr.message}`);
            groupId = existing.id;
            toast.info(`Grupo "${familyName}" já existia — produtos adicionados a ele.`);
          } else {
            throw new Error(`Falha ao criar grupo: ${gErr.message}`);
          }
        } else {
          groupId = newGroup.id;
        }
      } else {
        groupId = selectedGroupId;
      }

      // 2) Cria 1 produto por cor
      const prefix = (skuPrefix || slugForSku(familyName)).toUpperCase();
      const rows = colors.map(color => ({
        name: `${familyName.trim()} - ${color}`,
        sku: `${prefix}-${slugForSku(color)}`,
        color,
        group_id: groupId,
        unit,
        unit_price: unitPrice,
        supplier_id: supplierId || null,
        supplier_lead_time_days: supplierLeadDays,
        quantity: 0,
        active: true,
      }));

      const { data: createdProducts, error: pErr } = await (supabase as any)
        .from('products')
        .insert(rows)
        .select('id, name');

      if (pErr) {
        // Se algum SKU já existe (conflito), notifica
        if (pErr.code === '23505') {
          throw new Error('Algum SKU já existe. Ajuste o prefixo do SKU e tente novamente.');
        }
        throw new Error(`Falha ao criar produtos: ${pErr.message}`);
      }

      toast.success(`${createdProducts?.length || 0} produto(s) criado(s) na família "${familyName}"`);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product_groups'] });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      console.error('[QuickFamilyDialog] erro:', err);
      toast.error(err.message || 'Erro inesperado');
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
            Cadastro Rápido — Família com Cores
          </DialogTitle>
          <DialogDescription>
            Use pra cadastrar de uma vez um material que tem várias cores (ex: "Tira Chata 10mm" em
            Preto, Branco, Caramelo). O sistema cria a família e os produtos automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* ── Família ── */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Layers className="h-3.5 w-3.5" /> Família
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <Label htmlFor="fam-name" className="text-xs">Nome da família <span className="text-red-500">*</span></Label>
                <Input
                  id="fam-name"
                  value={familyName}
                  onChange={e => {
                    setFamilyName(e.target.value);
                    if (!skuPrefix) setSkuPrefix(slugForSku(e.target.value));
                  }}
                  className="mt-1 h-10"
                  placeholder="Ex: Tira Chata 10mm"
                  autoFocus
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Cada produto cadastrado vai usar este nome + a cor (ex: "Tira Chata 10mm - Preto")
                </p>
              </div>

              <div>
                <Label htmlFor="fam-sku-prefix" className="text-xs">Prefixo do SKU</Label>
                <Input
                  id="fam-sku-prefix"
                  value={skuPrefix}
                  onChange={e => setSkuPrefix(e.target.value.toUpperCase().slice(0, 12))}
                  className="mt-1 h-10 font-mono"
                  placeholder="TIRA"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  SKU final: <span className="font-mono">{(skuPrefix || 'TIRA')}-PRETO</span>
                </p>
              </div>

              <div>
                <Label className="text-xs">Onde criar?</Label>
                <Select value={groupMode} onValueChange={v => setGroupMode(v as any)}>
                  <SelectTrigger className="mt-1 h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Criar nova família</SelectItem>
                    <SelectItem value="existing">Usar família existente</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {groupMode === 'existing' && (
                <div className="md:col-span-2">
                  <Label className="text-xs">Família existente <span className="text-red-500">*</span></Label>
                  <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                    <SelectTrigger className="mt-1 h-10"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          {/* ── Cores ── */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Plus className="h-3.5 w-3.5" /> Cores ({colors.length})
            </div>

            <div className="flex gap-2">
              <Input
                value={colorInput}
                onChange={e => setColorInput(e.target.value)}
                onKeyDown={handleKey}
                onBlur={() => colorInput.trim() && addColor(colorInput)}
                className="h-10 flex-1"
                placeholder="Digite uma cor e pressione Enter…"
              />
              <Button type="button" variant="outline" onClick={() => addColor(colorInput)} disabled={!colorInput.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Atalhos */}
            <div className="flex flex-wrap gap-1.5">
              {COMMON_COLORS.filter(c => !colors.some(x => x.toLowerCase() === c.toLowerCase())).map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => addColor(c)}
                  className="text-xs px-2 py-1 rounded-md border border-dashed border-border hover:bg-accent hover:border-primary/40"
                >
                  + {c}
                </button>
              ))}
            </div>

            {/* Cores selecionadas */}
            {colors.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/40">
                {colors.map(c => (
                  <Badge key={c} variant="secondary" className="gap-1 pr-1">
                    {c}
                    <button type="button" onClick={() => removeColor(c)} className="hover:bg-muted rounded-full p-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Serão criados <span className="font-bold text-primary">{colors.length} produto(s)</span> — um por cor, todos vinculados à mesma família.
            </p>
          </div>

          {/* ── Especificações padrão (aplicadas a todas as cores) ── */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Especificações padrão
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Unidade</Label>
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger className="mt-1 h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="un">Unidade</SelectItem>
                    <SelectItem value="m">Metro</SelectItem>
                    <SelectItem value="cm">Centímetro</SelectItem>
                    <SelectItem value="kg">Quilograma</SelectItem>
                    <SelectItem value="dm²">dm²</SelectItem>
                    <SelectItem value="par">Par</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Preço unitário (R$)</Label>
                <NumberInput value={unitPrice} onChange={setUnitPrice} min={0} step="0.01" className="mt-1 h-10" />
              </div>
              <div>
                <Label className="text-xs">Lead time fornecedor (dias)</Label>
                <NumberInput value={supplierLeadDays} onChange={setSupplierLeadDays} min={1} step="1" className="mt-1 h-10" />
              </div>
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
          <Button type="button" onClick={handleSubmit} disabled={submitting || !familyName.trim() || colors.length === 0} className="gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar família com {colors.length} cor{colors.length !== 1 ? 'es' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
