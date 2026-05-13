import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CircleNotch as Loader2, Package, MagnifyingGlass as Search, Gear as Settings2, Stack as Boxes, ClockCounterClockwise as History, Warning as AlertTriangle, CaretRight as ChevronRight, ListPlus } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { cn } from '@/lib/utils';
import SolesCadastroTab from '@/components/soles-hub/SolesCadastroTab';
import SolesEstoqueTab from '@/components/soles-hub/SolesEstoqueTab';
import SolesConsumosTab from '@/components/soles-hub/SolesConsumosTab';
import SolesHistoricoTab from '@/components/soles-hub/SolesHistoricoTab';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

// ── Tipos ───────────────────────────────────────────────────────────────────
import type { SoleProduct } from '@/components/soles-hub/types';
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
  const { data: soles = [], isLoading } = useSoleProducts();
  const [tab, setTab] = usePersistedState<string>('soles-hub-tab', 'cadastro');
  const [selectedId, setSelectedId] = usePersistedState<string | null>('soles-hub-selected', null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return soles;
    return soles.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.color || '').toLowerCase().includes(q)
    );
  }, [soles, search]);

  // Agrupa por nome base (descarta cor pra agrupar variantes do mesmo solado)
  const grouped = useMemo(() => {
    const map = new Map<string, SoleProduct[]>();
    for (const p of filtered) {
      // Nome base = nome sem a cor entre parênteses
      const base = p.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (!map.has(base)) map.set(base, []);
      map.get(base)!.push(p);
    }
    // Ordena por nome base
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
      .map(([base, items]) => ({ base, items }));
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
          sectionLabel="PRODUÇÃO · SOLADOS"
          title="Gestão de Solados"
          description="Tudo sobre solados num só lugar — cadastro, conjugação, estoque e consumos."
          actions={
            <div className="flex gap-3">
              <Card className="px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Solados</p>
                <p className="text-lg font-bold font-mono">{stats.totalSoles}</p>
              </Card>
              <Card className="px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pares em estoque</p>
                <p className="text-lg font-bold font-mono">{stats.totalPairs.toLocaleString('pt-BR')}</p>
              </Card>
              {stats.lowStock > 0 && (
                <Card className="px-3 py-2 border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/20">
                  <p className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Abaixo do mínimo
                  </p>
                  <p className="text-lg font-bold font-mono text-amber-700 dark:text-amber-400">{stats.lowStock}</p>
                </Card>
              )}
            </div>
          }
        />

        {/* Layout: lista esquerda + detalhe direita */}
        <div className="grid grid-cols-12 gap-4 min-h-[600px]">
          {/* Lista de solados (esquerda) */}
          <Card className="col-span-12 md:col-span-4 lg:col-span-3 flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">Solados ativos</CardTitle>
                <Badge variant="secondary" className="text-[10px]">{filtered.length}</Badge>
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="h-8 pl-7 text-sm"
                  placeholder="Buscar solado, SKU, cor..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : grouped.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  Nenhum solado encontrado
                </div>
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
                      <div key={group.base}>
                        {/* Header do grupo (modelo) */}
                        <div className="px-3 py-1.5 bg-muted/30 border-b border-border/60 flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground truncate">
                            {group.base}
                          </span>
                          <Badge variant="secondary" className="text-[9px] h-4 px-1 leading-none">
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
            </CardContent>
          </Card>

          {/* Detalhe do solado selecionado (direita) */}
          <div className="col-span-12 md:col-span-8 lg:col-span-9">
            {!selected ? (
              <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center py-16">
                  <ListPlus className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    Selecione um solado da lista pra ver e editar suas configurações.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="h-full">
                <CardHeader className="pb-3 border-b">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {selected.name}
                        {selected.color && (
                          <Badge variant="secondary" className="text-xs">{selected.color}</Badge>
                        )}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {selected.sku && <>SKU: <span className="font-mono">{selected.sku}</span> · </>}
                        Total em estoque: <span className="font-mono font-medium">{gradeTotal(selected.stock_grade)}</span> pares
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
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
                </CardContent>
              </Card>
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
            <span className="font-mono text-[9px] text-muted-foreground/70 truncate max-w-[80px]">
              {sole.sku}
            </span>
          )}
          <span className={cn(
            'text-[10px] font-mono',
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
