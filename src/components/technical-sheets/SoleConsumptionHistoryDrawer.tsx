import { useMemo } from 'react';
import { ClockCounterClockwise as History, ArrowRight, Plus, Trash as Trash2, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

type AuditRow = {
  id: string;
  size: number;
  old_consumption: number | null;
  new_consumption: number | null;
  old_unit: string | null;
  new_unit: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_by: string | null;
  changed_at: string;
  standard_item_id: string;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  soleProductId: string;
  soleLabel: string;
}

function formatDateTime(iso: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function ActionIcon({ action }: { action: AuditRow['action'] }) {
  if (action === 'INSERT') return <Plus className="h-3.5 w-3.5 text-green-600" />;
  if (action === 'DELETE') return <Trash2 className="h-3.5 w-3.5 text-destructive" />;
  return <ArrowRight className="h-3.5 w-3.5 text-amber-600" />;
}

export function SoleConsumptionHistoryDrawer({ open, onOpenChange, soleProductId, soleLabel }: Props) {
  const { data: audit = [], isLoading } = useQuery<AuditRow[]>({
    queryKey: ['sole_standard_items_audit', soleProductId],
    enabled: !!soleProductId && open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sole_standard_items_audit')
        .select('*')
        .eq('sole_product_id', soleProductId)
        .order('changed_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as AuditRow[];
    },
    staleTime: 30_000,
  });

  // Resolve names: items + users
  const itemIds = useMemo(() => Array.from(new Set(audit.map((r) => r.standard_item_id))), [audit]);
  const userIds = useMemo(
    () => Array.from(new Set(audit.map((r) => r.changed_by).filter(Boolean) as string[])),
    [audit],
  );

  const { data: items = [] } = useQuery({
    queryKey: ['audit_items_names', itemIds],
    enabled: itemIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, color')
        .in('id', itemIds);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ['audit_profiles', userIds],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const itemNameById = useMemo(() => {
    const m = new Map<string, string>();
    (items as any[]).forEach((p) => m.set(p.id, p.color ? `${p.name} (${p.color})` : p.name));
    return m;
  }, [items]);

  const userNameById = useMemo(() => {
    const m = new Map<string, string>();
    profiles.forEach((p: any) => m.set(p.id, p.full_name || p.email || p.id.slice(0, 8)));
    return m;
  }, [profiles]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Histórico de alterações
          </SheetTitle>
          <SheetDescription>
            Solado: <strong>{soleLabel}</strong> · Últimas 500 alterações de consumo base.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 mt-4 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : audit.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/20 p-8 text-center text-xs text-muted-foreground">
              Nenhuma alteração registrada para este solado ainda.
              <br />
              O histórico passa a ser gravado automaticamente a partir desta data.
            </div>
          ) : (
            <ScrollArea className="h-full pr-3">
              <ul className="space-y-2">
                {audit.map((r) => {
                  const itemName = itemNameById.get(r.standard_item_id) || r.standard_item_id.slice(0, 8);
                  const user = r.changed_by ? userNameById.get(r.changed_by) || '—' : 'sistema';
                  return (
                    <li
                      key={r.id}
                      className="rounded-md border border-border/60 bg-background p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <ActionIcon action={r.action} />
                          <span className="font-medium truncate">{itemName}</span>
                          <Badge variant="outline" className="text-xs px-1.5 py-0">
                            num. {r.size}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatDateTime(r.changed_at)} · {user}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 font-mono text-xs">
                        {r.action === 'INSERT' && (
                          <Badge className="bg-green-500/10 text-green-700 hover:bg-green-500/10 border-green-500/30 text-xs">
                            +{Number(r.new_consumption ?? 0)} {r.new_unit ?? ''}
                          </Badge>
                        )}
                        {r.action === 'DELETE' && (
                          <Badge variant="outline" className="text-destructive border-destructive/40 text-xs">
                            removido ({Number(r.old_consumption ?? 0)} {r.old_unit ?? ''})
                          </Badge>
                        )}
                        {r.action === 'UPDATE' && (
                          <span className="flex items-center gap-1">
                            <span className="line-through text-muted-foreground">
                              {Number(r.old_consumption ?? 0)} {r.old_unit ?? ''}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <span className="text-foreground font-semibold">
                              {Number(r.new_consumption ?? 0)} {r.new_unit ?? ''}
                            </span>
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface ButtonProps {
  onClick: () => void;
}
export function HistoryButton({ onClick }: ButtonProps) {
  return (
    <Button onClick={onClick} size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
      <History className="h-3.5 w-3.5" />
      Histórico
    </Button>
  );
}
