import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle,
  Cube as Box,
  MagnifyingGlass as Search,
  Warning as AlertTriangle,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import SolePackagingPanel from '@/components/soles-hub/SolePackagingPanel';

interface SoleGroupRow {
  id: string;
  name: string;
  box_type_id: string | null;
  box_type_master_id: string | null;
  box_type_colmeia_id: string | null;
  box_type_fitilho_id: string | null;
  productsCount: number;
  sheetsCount: number;
}

type SoleGroupSource = Omit<SoleGroupRow, 'productsCount' | 'sheetsCount'>;

function readiness(group: SoleGroupRow) {
  const tradicional = !!group.box_type_id && !!group.box_type_master_id;
  const amarrado = !!group.box_type_id && !!group.box_type_fitilho_id;
  const colmeia = !!group.box_type_colmeia_id;
  return {
    tradicional,
    amarrado,
    colmeia,
    ready: [tradicional, amarrado, colmeia].filter(Boolean).length,
  };
}

export default function SolePackagingConfigurationPanel({ initialSoleGroupId }: { initialSoleGroupId?: string | null }) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialSoleGroupId ?? null);

  const { data: groups = [], isLoading } = useQuery<SoleGroupRow[]>({
    queryKey: ['packaging_sole_groups'],
    queryFn: async () => {
      const [groupsRes, productsRes, sheetsRes] = await Promise.all([
        supabase
          .from('product_groups')
          .select('id, name, box_type_id, box_type_master_id, box_type_colmeia_id, box_type_fitilho_id')
          .eq('sector', 'Solado')
          .order('name'),
        supabase.from('products').select('group_id').not('group_id', 'is', null),
        supabase.from('technical_sheets').select('sole_group_id').not('sole_group_id', 'is', null),
      ]);
      if (groupsRes.error) throw groupsRes.error;
      if (productsRes.error) throw productsRes.error;
      if (sheetsRes.error) throw sheetsRes.error;

      const productsByGroup = new Map<string, number>();
      for (const row of (productsRes.data ?? []) as Array<{ group_id: string }>) {
        const id = row.group_id;
        productsByGroup.set(id, (productsByGroup.get(id) ?? 0) + 1);
      }
      const sheetsByGroup = new Map<string, number>();
      for (const row of (sheetsRes.data ?? []) as Array<{ sole_group_id: string }>) {
        const id = row.sole_group_id;
        sheetsByGroup.set(id, (sheetsByGroup.get(id) ?? 0) + 1);
      }

      return ((groupsRes.data ?? []) as SoleGroupSource[]).map(group => ({
        ...group,
        productsCount: productsByGroup.get(group.id) ?? 0,
        sheetsCount: sheetsByGroup.get(group.id) ?? 0,
      }));
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (groups.length === 0) return;
    if (selectedId && groups.some(group => group.id === selectedId)) return;
    const firstIncomplete = groups.find(group => readiness(group).ready < 3);
    setSelectedId(firstIncomplete?.id ?? groups[0].id);
  }, [groups, selectedId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    if (!term) return groups;
    return groups.filter(group => group.name.toLocaleLowerCase('pt-BR').includes(term));
  }, [groups, search]);

  const selected = groups.find(group => group.id === selectedId) ?? null;

  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Skeleton className="h-[520px]" />
        <Skeleton className="h-[520px]" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="h-fit lg:sticky lg:top-4">
        <CardContent className="p-3 space-y-3">
          <div>
            <p className="text-sm font-semibold">Tipos de solado</p>
            <p className="text-xs text-muted-foreground">
              Cada configuração vale para todas as cores e referências vinculadas ao modelo.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar tipo de solado..."
              className="h-9 pl-8"
            />
          </div>
          <div className="max-h-[62vh] space-y-1 overflow-y-auto pr-1">
            {filtered.map(group => {
              const state = readiness(group);
              const active = group.id === selectedId;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedId(group.id)}
                  className={`w-full rounded-md border p-2.5 text-left transition-colors ${
                    active ? 'border-primary bg-primary/5' : 'border-transparent hover:border-border hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {state.ready === 3 ? (
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" weight="fill" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" weight="fill" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{group.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {group.sheetsCount} {group.sheetsCount === 1 ? 'ficha' : 'fichas'} · {group.productsCount} cores
                      </p>
                    </div>
                    <Badge variant="outline" className="h-5 shrink-0 text-xs font-mono">
                      {state.ready}/3
                    </Badge>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Nenhum tipo de solado encontrado.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selected ? (
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Box className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold">{selected.name}</h2>
              <p className="text-xs text-muted-foreground">
                {selected.sheetsCount} referências e {selected.productsCount} cores herdam esta configuração.
              </p>
            </div>
          </div>
          <SolePackagingPanel soleGroupId={selected.id} soleGroupName={selected.name} />
        </div>
      ) : (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Nenhum grupo do setor Solado foi cadastrado.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
