/**
 * Painel "Fontes de cores" — exibido abaixo do GroupColorsManager.
 *
 * Permite vincular grupos-origem cujas cores podem ser IMPORTADAS pra
 * paleta deste grupo (ex: Tira Overlock 5mm → Napa Soft, Napa Sudani).
 *
 * Fluxo:
 *   1. Operador adiciona Napa Soft como fonte (botão "Vincular fonte")
 *   2. Sistema lista as cores cadastradas em Napa Soft que ainda NÃO
 *      estão na paleta da Tira Overlock
 *   3. Operador marca quais cores quer importar
 *   4. Click "Importar selecionadas" adiciona as cores na paleta da tira
 *
 * Importação é SEMPRE manual — não importa nada automaticamente. Operador
 * controla quais cores da napa viram disponíveis pra tira (nem toda cor
 * de napa vira tira na prática).
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Link as LinkIcon, Plus, X, ArrowsDownUp as ArrowDownUp,
  Check, MagnifyingGlass as Search, Warning as AlertTriangle,
} from '@phosphor-icons/react';
import {
  useGroupColorSources,
  useAvailableSourceColors,
  useAddColorSource,
  useRemoveColorSource,
  useImportColorsFromSources,
} from '@/hooks/useGroupColorSources';
import { cn } from '@/lib/utils';

interface Props {
  groupId: string;
  groupName: string;
}

export default function GroupColorSourcesPanel({ groupId, groupName }: Props) {
  const { data: sources = [], isLoading: loadingSources } = useGroupColorSources(groupId);
  const { data: available = [], isLoading: loadingAvail } = useAvailableSourceColors(groupId);
  const addSource = useAddColorSource();
  const removeSource = useRemoveColorSource();
  const importMut = useImportColorsFromSources();

  const [selectedColorIds, setSelectedColorIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [pickSourceId, setPickSourceId] = useState<string>('');

  // Grupos elegíveis pra ser fonte (todos exceto o próprio e os já vinculados)
  const { data: allGroups = [] } = useQuery({
    queryKey: ['product_groups_min'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('product_groups')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string }>;
    },
    staleTime: 60_000,
  });

  const linkedIds = useMemo(() => new Set(sources.map(s => s.source_group_id)), [sources]);
  const candidateGroups = useMemo(
    () => allGroups.filter(g => g.id !== groupId && !linkedIds.has(g.id)),
    [allGroups, groupId, linkedIds],
  );

  const filteredAvailable = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return available;
    return available.filter(c =>
      c.color_name.toLowerCase().includes(q) ||
      c.source_group_name.toLowerCase().includes(q),
    );
  }, [available, search]);

  // Agrupa cores por source pra UI mais legível
  const groupedBySource = useMemo(() => {
    const map = new Map<string, typeof filteredAvailable>();
    for (const c of filteredAvailable) {
      const arr = map.get(c.source_group_id) || [];
      arr.push(c);
      map.set(c.source_group_id, arr);
    }
    return Array.from(map.entries()).map(([sid, items]) => ({
      sourceGroupId: sid,
      sourceGroupName: items[0]?.source_group_name ?? '—',
      colors: items,
    }));
  }, [filteredAvailable]);

  const toggleColor = (id: string) => {
    setSelectedColorIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllOfSource = (sourceGroupId: string, allSelected: boolean) => {
    const ids = filteredAvailable
      .filter(c => c.source_group_id === sourceGroupId)
      .map(c => c.color_id);
    setSelectedColorIds(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  const handleImport = async () => {
    if (selectedColorIds.size === 0) return;
    await importMut.mutateAsync({ groupId, colorIds: Array.from(selectedColorIds) });
    setSelectedColorIds(new Set());
  };

  const handleAddSource = async () => {
    if (!pickSourceId) return;
    await addSource.mutateAsync({ groupId, sourceGroupId: pickSourceId });
    setPickSourceId('');
  };

  return (
    <Card className="mt-4 border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ArrowDownUp className="h-4 w-4 text-primary" />
          Fontes de cores
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Vincule grupos cujas cores cadastradas podem ser importadas pra paleta de <strong>{groupName}</strong>.
          Útil quando este grupo é derivado de outro (ex: tira feita de napa). Importação é sempre manual —
          você escolhe quais cores quer disponíveis aqui.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Adicionar fonte */}
        <div className="flex items-center gap-2 flex-wrap">
          <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Vincular fonte:</span>
          <Select value={pickSourceId} onValueChange={setPickSourceId}>
            <SelectTrigger className="h-8 w-64 text-xs">
              <SelectValue placeholder="Selecionar grupo..." />
            </SelectTrigger>
            <SelectContent>
              {candidateGroups.map(g => (
                <SelectItem key={g.id} value={g.id} className="text-xs">{g.name}</SelectItem>
              ))}
              {candidateGroups.length === 0 && (
                <div className="text-xs text-muted-foreground p-2">
                  Sem grupos disponíveis (todos já vinculados ou só existe este).
                </div>
              )}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!pickSourceId || addSource.isPending}
            onClick={handleAddSource}
            className="h-8 gap-1"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Button>
        </div>

        {/* Lista de fontes vinculadas */}
        {loadingSources ? (
          <p className="text-xs text-muted-foreground">Carregando...</p>
        ) : sources.length === 0 ? (
          <div className="rounded-md bg-muted/30 border border-dashed p-3 text-xs text-muted-foreground flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-600 shrink-0" />
            Nenhuma fonte vinculada. Adicione um grupo acima pra começar a importar cores dele.
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">Vinculados:</span>
            {sources.map(s => (
              <Badge
                key={s.source_group_id}
                variant="secondary"
                className="gap-1 pl-2 pr-1 py-0.5 text-[11px]"
              >
                {s.source_group_name}
                <button
                  onClick={() => removeSource.mutate({ groupId, sourceGroupId: s.source_group_id })}
                  className="hover:bg-destructive/20 rounded p-0.5 transition-colors"
                  aria-label={`Remover ${s.source_group_name} como fonte`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {/* Cores disponíveis pra importar */}
        {sources.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-semibold text-foreground">
                Cores disponíveis pra importar
                <span className="ml-1.5 text-muted-foreground font-normal">
                  ({filteredAvailable.length})
                </span>
              </p>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar cor..."
                    className="h-7 w-44 pl-7 text-xs"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleImport}
                  disabled={selectedColorIds.size === 0 || importMut.isPending}
                  className="h-7 gap-1"
                >
                  <Check className="h-3.5 w-3.5" />
                  Importar selecionadas ({selectedColorIds.size})
                </Button>
              </div>
            </div>

            {loadingAvail ? (
              <p className="text-xs text-muted-foreground">Carregando cores...</p>
            ) : filteredAvailable.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center bg-muted/20 rounded-md">
                {available.length === 0
                  ? 'Todas as cores das fontes já estão na paleta deste grupo.'
                  : 'Nenhuma cor casa com a busca.'}
              </p>
            ) : (
              <div className="space-y-2">
                {groupedBySource.map(grp => {
                  const allSelected = grp.colors.every(c => selectedColorIds.has(c.color_id));
                  return (
                    <div key={grp.sourceGroupId} className="rounded-md border bg-muted/10">
                      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
                        <span className="text-xs font-semibold">{grp.sourceGroupName}</span>
                        <button
                          onClick={() => toggleAllOfSource(grp.sourceGroupId, allSelected)}
                          className="text-[10px] text-primary hover:underline"
                        >
                          {allSelected ? 'desmarcar todas' : 'marcar todas'}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5 p-2">
                        {grp.colors.map(c => {
                          const checked = selectedColorIds.has(c.color_id);
                          return (
                            <label
                              key={c.color_id}
                              className={cn(
                                'flex items-center gap-1.5 rounded-md border px-2 py-1 cursor-pointer transition-colors text-xs',
                                checked ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/30',
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleColor(c.color_id)}
                                className="h-3.5 w-3.5"
                              />
                              {c.color_hex && (
                                <span
                                  className="h-3 w-3 rounded-full border border-border/40 inline-block"
                                  style={{ background: c.color_hex }}
                                />
                              )}
                              <span>{c.color_name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
