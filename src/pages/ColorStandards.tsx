import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { ComponentColorDefaultsEditor } from '@/components/technical-sheets/ComponentColorDefaultsEditor';
import { useComponentColorDefaults } from '@/hooks/useComponentColorDefaults';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ArrowLeft, Palette, Plus, Check } from '@phosphor-icons/react';

/**
 * Padrões do Calçado — hub de padronizações globais do módulo de Fichas
 * Técnicas. Hoje: regras GLOBAIS de componente/tira por cor
 * (component_color_defaults): grupo + cor do pedido → SKU padrão, válido pra
 * qualquer modelo que use o grupo. A ficha continua definindo a quantidade;
 * a lista "Componentes por Cor" da ficha sempre vence a regra global.
 */
export default function ColorStandards() {
  const { data: allRules = [] } = useComponentColorDefaults();

  const { data: groups = [] } = useQuery({
    queryKey: ['product_groups_for_color_standards'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_groups')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string }>;
    },
  });

  // Grupos que já têm regra + grupos abertos manualmente nesta sessão.
  const [openedGroupIds, setOpenedGroupIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const groupNameById = useMemo(() => new Map(groups.map(g => [g.id, g.name])), [groups]);
  const rulesByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRules) m.set(r.group_id, (m.get(r.group_id) || 0) + 1);
    return m;
  }, [allRules]);

  const visibleGroupIds = useMemo(() => {
    const ids = new Set<string>([...rulesByGroup.keys(), ...openedGroupIds]);
    return Array.from(ids).sort((a, b) =>
      (groupNameById.get(a) || '').localeCompare(groupNameById.get(b) || '', 'pt-BR'));
  }, [rulesByGroup, openedGroupIds, groupNameById]);

  return (
    <div className="space-y-5 page-enter editorial-stagger">
      <EditorialPageHeader
        sectionLabel="ENGENHARIA · FICHAS"
        title="Padrões do Calçado"
        description="Regras globais por cor — componentes e tiras"
        actions={
          <>
            <Button variant="outline" asChild className="gap-2">
              <Link to="/fichas-tecnicas">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Fichas Técnicas</span>
              </Link>
            </Button>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Adicionar grupo</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="end">
                <Command>
                  <CommandInput placeholder="Buscar grupo (ex: TIRA STRASS 6MM)…" />
                  <CommandList>
                    <CommandEmpty>Nenhum grupo encontrado.</CommandEmpty>
                    <CommandGroup>
                      {groups.map(g => {
                        const alreadyVisible = rulesByGroup.has(g.id) || openedGroupIds.includes(g.id);
                        return (
                          <CommandItem
                            key={g.id}
                            value={g.name}
                            onSelect={() => {
                              if (!alreadyVisible) setOpenedGroupIds(prev => [...prev, g.id]);
                              setPickerOpen(false);
                            }}
                          >
                            <span className="truncate">{g.name}</span>
                            {alreadyVisible && <Check className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </>
        }
      />

      <p className="text-sm text-muted-foreground max-w-3xl">
        Regra global: <strong className="text-foreground">grupo de componente + cor do pedido → produto padrão</strong>,
        valendo pra <strong className="text-foreground">qualquer modelo</strong> que use o grupo (componentes da ficha e
        tiras do PV) — ex.: TIRA STRASS 6MM na cor Preta ⇒ sempre a tira preto com fundo preto. A ficha continua
        definindo a quantidade; a lista "Componentes por Cor" de cada ficha sempre vence a regra global. Débito,
        reserva, custeio, compras e MRP herdam a regra automaticamente.
      </p>

      {visibleGroupIds.length === 0 ? (
        <EmptyState
          icon={Palette}
          title="Nenhum padrão cadastrado"
          description='Use "Adicionar grupo" pra escolher um grupo de componente (ex.: TIRA STRASS 6MM) e definir o produto padrão de cada cor.'
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visibleGroupIds.map(gid => (
            <Card key={gid}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Palette className="h-4 w-4 text-primary" />
                  <span className="truncate">{groupNameById.get(gid) || 'Grupo'}</span>
                  <Badge variant="outline" className="text-xs ml-auto shrink-0">
                    {rulesByGroup.get(gid) || 0} {(rulesByGroup.get(gid) || 0) === 1 ? 'regra' : 'regras'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ComponentColorDefaultsEditor groupId={gid} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
