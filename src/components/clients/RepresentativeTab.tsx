import { useState, useMemo } from 'react';
import { UserCheck, Plus, Trash as Trash2, MagnifyingGlass } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRepresentatives, Representative } from '@/hooks/useRepresentatives';
import {
  useClientRepresentatives, useAddClientRepresentative, useRemoveClientRepresentative,
  useEconomicGroupRepresentatives, useAddGroupRepresentative, useRemoveGroupRepresentative,
} from '@/hooks/useClientRepresentatives';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';

interface Props {
  entityId: string | null;
  type: 'client' | 'group';
}

export default function RepresentativeTab({ entityId, type }: Props) {
  const { data: allReps = [] } = useRepresentatives();
  const { data: clientReps = [] } = useClientRepresentatives(type === 'client' ? entityId : null);
  const { data: groupReps = [] } = useEconomicGroupRepresentatives(type === 'group' ? entityId : null);
  const addClientRep = useAddClientRepresentative();
  const removeClientRep = useRemoveClientRepresentative();
  const addGroupRep = useAddGroupRepresentative();
  const removeGroupRep = useRemoveGroupRepresentative();

  const [addDialog, setAddDialog] = useState(false);
  const [search, setSearch] = useState('');

  const linkedReps = type === 'client' ? clientReps : groupReps;
  const linkedRepIds = new Set(linkedReps.map((r: any) => r.representative_id));

  const unlinkedReps = useMemo(
    () => allReps.filter(r => r.active && !linkedRepIds.has(r.id)),
    [allReps, linkedRepIds],
  );

  const availableReps = useMemo(
    () => unlinkedReps.filter(r => searchMatchesAllTerms(search, r.name, r.email, r.phone, r.cidade)),
    [unlinkedReps, search],
  );

  const handleAdd = (rep: Representative) => {
    if (!entityId) return;
    if (type === 'client') {
      addClientRep.mutate({ clientId: entityId, representativeId: rep.id });
    } else {
      addGroupRep.mutate({ groupId: entityId, representativeId: rep.id });
    }
  };

  const handleRemove = (linkId: string) => {
    if (!entityId) return;
    if (type === 'client') {
      removeClientRep.mutate({ id: linkId, clientId: entityId });
    } else {
      removeGroupRep.mutate({ id: linkId, groupId: entityId });
    }
  };

  if (!entityId) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        <UserCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>Salve o cadastro primeiro para vincular representantes.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{linkedReps.length} {linkedReps.length === 1 ? 'representante vinculado' : 'representantes vinculados'}</p>
        <Button type="button" size="sm" className="gap-1.5" onClick={() => { setSearch(''); setAddDialog(true); }}>
          <Plus className="h-4 w-4" />Vincular
        </Button>
      </div>

      {linkedReps.length > 0 ? (
        <div className="rounded-md border divide-y max-h-48 overflow-y-auto">
          {linkedReps.map((link: any) => {
            const rep = link.representatives;
            return (
              <div key={link.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{rep?.name || '—'}</span>
                  {rep?.commission_pct > 0 && (
                    <Badge variant="secondary" className="ml-2 text-xs">{rep.commission_pct}%</Badge>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {[rep?.phone, rep?.email].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleRemove(link.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={UserCheck} title="Nenhum representante vinculado" size="sm" />
      )}

      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Vincular Representante</DialogTitle>
          </DialogHeader>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome, e-mail, telefone ou cidade..."
            resultCount={availableReps.length}
            totalCount={unlinkedReps.length}
          />
          <div className="flex-1 overflow-y-auto rounded-md border divide-y min-h-0 max-h-[50vh]">
            {availableReps.length === 0 ? (
              search.trim() ? (
                <EmptyState
                  size="sm"
                  icon={MagnifyingGlass}
                  title={`Nenhum resultado para "${search}"`}
                  action={<Button type="button" variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>}
                />
              ) : (
                <EmptyState icon={UserCheck} title="Nenhum representante disponível" size="sm" />
              )
            ) : (
              availableReps.map(rep => (
                <button key={rep.id} type="button" onClick={() => { handleAdd(rep); setAddDialog(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors">
                  <UserCheck className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{rep.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[rep.phone, rep.email, rep.cidade].filter(Boolean).join(' · ')}
                      {rep.commission_pct > 0 && ` · ${rep.commission_pct}% comissão`}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
