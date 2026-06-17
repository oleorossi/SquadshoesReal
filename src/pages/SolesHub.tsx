import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { CircleNotch as Loader2, Package, MagnifyingGlass as Search, Gear as Settings2, Stack as Boxes, ClockCounterClockwise as History, Warning as AlertTriangle, CaretRight as ChevronRight, ListPlus, Plus, Trash } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { cn } from '@/lib/utils';
import SolesCadastroTab from '@/components/soles-hub/SolesCadastroTab';
import SolesEstoqueTab from '@/components/soles-hub/SolesEstoqueTab';
import SolesConsumosTab from '@/components/soles-hub/SolesConsumosTab';
import SolesHistoricoTab from '@/components/soles-hub/SolesHistoricoTab';
import SoleCreateDialog from '@/components/soles-hub/SoleCreateDialog';
import { useForceDeleteProductFlow } from '@/components/inventory/ForceDeleteProductDialog';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

// ── Tipos ───────────────────────────────────────────────────────────────────
import type { SoleProduct } from '@/components/soles-hub/types';
import { normalizeForSearch } from '@/lib/searchUtils';
export type { SoleProduct };

function isSoleProduct(category: string | null): boolean {
  const cat = (category ?? '').toLowerCase();
  return cat === 'solado' || cat === 'sola' || cat.startsWith('solado');
}

// Soma do estoque por grade (ignora chaves _size_from / _size_to)
function gradeTotal(grade: Record<string, any> | null): number {
  if (!grade) return 0;
  return Object.entries(grade)
    .filter(([k]) => !k.startsWith('_'))
    .reduce((s, [, v]) => s + (Number(v) || 0), 0);
}

// ── Hook: carrega TODOS os solados ativos ──────────────────────────────────
function useSoleProducts() {
  return useQuery({
    queryKey: ['soles_hub_products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, category, color, quantity, unit, min_stock, stock_grade, group_id, active, sole_classification')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      const all = (data || []) as SoleProduct[];
      return all.filter(p => isSoleProduct(p.category));
    },
    staleTime: 30_000,
  });
}

// ── Página principal ──────────────────────────────────────────────────────
export default function SolesHub() {
  const qc = useQueryClient();
  const { data: soles = [], isLoading } = useSoleProducts();
  const [tab, setTab] = usePersistedState<string>('soles-hub-tab', 'cadastro');
  const [selectedId, setSelectedId] = usePersistedState<string | null>('soles-hub-selected', null);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Exclusão de solado — reaproveita o fluxo padrão de exclusão de produto
  // (solado É um row de `products`). Faz delete direto se não há vínculos;
  // se houver (movimentações de estoque, fichas, reservas), abre o dialog de
  // exclusão forçada com confirmação dupla via RPC force_delete_product.
  // O hook só invalida ['products'], então o onSuccess aqui também invalida a
  // query do hub e desseleciona o solado apagado.
  const deleteFlow = useForceDeleteProductFlow({
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['soles_hub_products'] });
      setSelectedId(null);
    },
  });

  const filtered = useMemo(() => {
    const q = normalizeForSearch(search);
    if (!q) return soles;
    return soles.filter(p =>
      normalizeForSearch(p.name).includes(q) ||
      normalizeForSearch(p.sku).includes(q) ||
      normalizeForSearch(p.color).includes(q)
    );
  }, [soles, search]);

  // Nome base = nome sem a cor: remove o parêntese final E o sufixo " - COR" da
  // própria variante (ex.: "204 - CARAMELO" → "204"). Assim variantes do mesmo
  // modelo com a cor embutida no nome não fragmentam o rótulo.
  const cleanBase = (name: string, color?: string | null) => {
    let base = (name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const c = (color || '').trim();
    if (c) {
      const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stripped = base.replace(new RegExp('[\\s\\-–—/]+' + esc + '\\s*$', 'i'), '').trim();
      if (stripped) base = stripped; // nunca esvazia (caso nome == cor)
    }
    return base;
  };

  // Agrupa por FAMÍLIA = group_id (modelo canônico: 1 grupo = 1 família; a cor
  // mora em products.color, nunca no nome). Sem group_id, cai no nome base.
  // Antes agrupava só por nome base — solados com a cor embutida no nome
  // (ex.: "204 - CARAMELO" + "204 - Preto" no MESMO group_id "SOLADO 204")
  // apareciam como 2 famílias distintas. (Fix 2026-06-17.)
  const grouped = useMemo(() => {
    const map = new Map<string, { items: SoleProduct[]; labels: Map<string, number> }>();
    for (const p of filtered) {
      const base = cleanBase(p.name, p.color);
      const key = p.group_id ? `g:${p.group_id}` : `n:${base.toLowerCase()}`;
      let entry = map.get(key);
      if (!entry) { entry = { items: [], labels: new Map() }; map.set(key, entry); }
      entry.items.push(p);
      entry.labels.set(base, (entry.labels.get(base) || 0) + 1);
    }
    // Rótulo do grupo = nome base mais frequente (desempate alfabético).
    return Array.from(map.entries())
      .map(([key, e]) => {
        const base = [...e.labels.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))[0]?.[0] ?? '';
        return { key, base, items: e.items };
      })
      .sort((a, b) => a.base.localeCompare(b.base, 'pt-BR'));
  }, [filtered]);

  const selected = useMemo(() =>
    selectedId ? soles.find(p => p.id === selectedId) || null : null,
    [selectedId, soles]
  );

  // Stats agregados pra header
  const stats = useMemo(() => {
    const totalPairs = soles.reduce((s, p) => s + gradeTotal(p.stock_grade), 0);
    const lowStock = soles.filter(p => gradeTotal(p.stock_grade) < (p.min_stock || 0)).length;
    return { totalSoles: soles.length, totalPairs, lowStock };
  }, [soles]);

  return (
    <AppLayout>
      <div className="space-y-4 page-enter editorial-stagger">
        <EditorialPageHeader
          sectionLabel="ENGENHARIA · SOLADOS"
          title="Gestão de Solados"
          description="Tudo sobre solados num só lugar — cadastro, conjugação, estoque e consumos."
          actions={
            <div className="flex items-center gap-3 flex-wrap">
              <Card className="px-3 py-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Solados</p>
                <p className="text-lg font-bold font-mono">{stats.totalSoles}</p>
              </Card>
              <Card className="px-3 py-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Pares em estoque</p>
                <p className="text-lg font-bold font-mono">{stats.totalPairs.toLocaleString('pt-BR')}</p>
              </Card>
              {stats.lowStock > 0 && (
                <Card className="px-3 py-2 border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/20">
                  <p className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Abaixo do mínimo
                  </p>
                  <p className="text-lg font-bold font-mono text-amber-700 dark:text-amber-400">{stats.lowStock}</p>
                </Card>
              )}
              <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Adicionar Solado
              </Button>
            </div>
          }
        />

        <SoleCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(newId) => {
            // Auto-seleciona o solado recém-criado e abre na aba Cadastro
            setSelectedId(newId);
            setTab('cadastro');
          }}
        />

        {/* Dialog de exclusão forçada (aparece quando o solado tem vínculos) */}
        {deleteFlow.dialog}

        {/* Layout: lista esquerda + detalhe direita */}
        <div className="grid grid-cols-12 gap-4 min-h-[600px]">
          {/* Lista de solados (esquerda) */}
          <Panel
            className="col-span-12 md:col-span-4 lg:col-span-3 flex flex-col"
            title="Solados ativos"
            actions={<Badge variant="secondary" className="text-xs">{filtered.length}</Badge>}
            flush
            bodyClassName="flex flex-col flex-1 min-h-0"
          >
            <div className="p-3 pb-2 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="h-8 pl-7 text-sm"
                  placeholder="Buscar solado, SKU, cor..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 min-h-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : grouped.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={Package}
                  title="Nenhum solado encontrado"
                  description="Ajuste a busca para localizar um solado."
                />
              ) : (
                <ScrollArea className="h-[600px]">
                  <div className="divide-y">
                    {/* Lista expandida — 1 linha POR COR (não agrupa).
                        Decisão (mai/2026): cor é variante de estoque/expedição,
                        mas o usuário precisa enxergar cada uma como item separado
                        pra ver e ajustar estoque. Toda info técnica (consumo,
                        conjugação de numeração, range, nome) já replica entre
                        cores ao salvar — então o "duplicar visual" não duplica
                        o cadastro técnico de fato. Cabeçalho do grupo agrupa
                        visualmente as cores do mesmo modelo. */}
                    {grouped.map(group => (
                      <div key={group.key}>
                        {/* Header do grupo (modelo) */}
                        <div className="px-3 py-1.5 bg-muted/30 border-b border-border/60 flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground truncate">
                            {group.base}
                          </span>
                          <Badge variant="secondary" className="text-xs h-4 px-1 leading-none">
                            {group.items.length} {group.items.length === 1 ? 'cor' : 'cores'}
                          </Badge>
                        </div>
                        {/* Lista de cores do grupo */}
                        {group.items
                          .slice()
                          .sort((a, b) => (a.color || '').localeCompare(b.color || '', 'pt-BR'))
                          .map(item => (
                            <SoleListItem
                              key={item.id}
                              sole={item}
                              selected={selectedId === item.id}
                              onSelect={() => setSelectedId(item.id)}
                            />
                          ))}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </Panel>

          {/* Detalhe do solado selecionado (direita) */}
          <div className="col-span-12 md:col-span-8 lg:col-span-9">
            {!selected ? (
              <Panel className="h-full" bodyClassName="h-full flex items-center justify-center">
                <EmptyState
                  icon={ListPlus}
                  title="Nenhum solado selecionado"
                  description="Selecione um solado da lista pra ver e editar suas configurações."
                />
              </Panel>
            ) : (
              <Panel
                className="h-full"
                title={
                  <span className="flex items-center gap-2 text-base">
                    {selected.name}
                    {selected.color && (
                      <Badge variant="secondary" className="text-xs">{selected.color}</Badge>
                    )}
                  </span>
                }
                subtitle={
                  <>
                    {selected.sku && <>SKU: <span className="font-mono">{selected.sku}</span> · </>}
                    Total em estoque: <span className="font-mono font-medium">{gradeTotal(selected.stock_grade)}</span> pares
                  </>
                }
                actions={
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash className="h-3.5 w-3.5" />
                        Excluir
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Excluir solado “{selected.name}”{selected.color ? ` · ${selected.color}` : ''}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Remove esta variante do cadastro de solados. Se houver histórico
                          (movimentações de estoque, fichas técnicas ou reservas), o sistema
                          pedirá uma confirmação extra antes de apagar tudo. Para apenas tirar
                          de uso preservando o histórico, prefira <strong>desativar</strong>.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteFlow.tryDelete(selected.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Excluir
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                }
              >
                  <Tabs value={tab} onValueChange={setTab} className="w-full">
                    <HubTabsList tabs={[
                      { value: 'cadastro',  label: 'Cadastro',   icon: Settings2 },
                      { value: 'estoque',   label: 'Estoque',    icon: Boxes },
                      { value: 'consumos',  label: 'Consumos',   icon: ListPlus },
                      { value: 'historico', label: 'Histórico',  icon: History },
                    ]} />

                    {/* key={selected.id} força remount ao trocar de solado —
                        sem isso, useState interno dos subcomponentes fica preso
                        nos valores iniciais do primeiro solado selecionado. */}
                    <TabsContent value="cadastro" className="mt-4">
                      <SolesCadastroTab key={selected.id} sole={selected} />
                    </TabsContent>
                    <TabsContent value="estoque" className="mt-4">
                      <SolesEstoqueTab key={selected.id} sole={selected} />
                    </TabsContent>
                    <TabsContent value="consumos" className="mt-4">
                      <SolesConsumosTab key={selected.id} sole={selected} />
                    </TabsContent>
                    <TabsContent value="historico" className="mt-4">
                      <SolesHistoricoTab key={selected.id} sole={selected} />
                    </TabsContent>
                  </Tabs>
              </Panel>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// ── Item da lista lateral (1 linha = 1 cor) ───────────────────────────────
function SoleListItem({ sole, selected, onSelect }: {
  sole: SoleProduct;
  selected: boolean;
  onSelect: () => void;
}) {
  const total = gradeTotal(sole.stock_grade);
  const isLow = total < (sole.min_stock || 0);
  const isZero = total === 0;
  const colorLabel = sole.color?.trim() || '— sem cor';
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left pl-5 pr-3 py-2 hover:bg-muted/50 transition-colors flex items-center justify-between gap-2',
        selected && 'bg-primary/10 hover:bg-primary/15 border-l-2 border-l-primary'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-foreground/40 shrink-0" aria-hidden="true" />
          <p className="text-sm font-medium truncate">{colorLabel}</p>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 ml-3.5">
          {sole.sku && (
            <span className="font-mono text-xs text-muted-foreground/70 truncate max-w-[80px]">
              {sole.sku}
            </span>
          )}
          <span className={cn(
            'text-xs font-mono',
            isZero ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-muted-foreground'
          )}>
            {total} {total === 1 ? 'par' : 'pares'}
          </span>
        </div>
      </div>
      <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', selected && 'rotate-90 text-primary')} />
    </button>
  );
}
