import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CircleNotch as Loader2, Sparkle, Check } from '@phosphor-icons/react';
import { EmptyState } from '@/components/ui/empty-state';
import { useSuggestGroupFamilies, useApplyFamilySuggestion } from '@/hooks/useGroupOrganization';
import { sectorLabel } from '@/lib/categoryFromGroup';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Sugestões opt-in de famílias: agrupa grupos-folha soltos por prefixo de nome
 * (dentro do mesmo setor). Nada é aplicado sozinho — cada sugestão exige 1 clique
 * em "Criar família". O nome é editável antes de aplicar.
 */
export default function FamilySuggestionsDialog({ open, onOpenChange }: Props) {
  const { data: suggestions = [], isLoading } = useSuggestGroupFamilies(open);
  const apply = useApplyFamilySuggestion();
  const [names, setNames] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const init: Record<string, string> = {};
      suggestions.forEach((s, i) => { init[`${s.sector}::${s.suggested_family}::${i}`] = s.suggested_family; });
      setNames(init);
    }
  }, [open, suggestions]);

  const handleApply = async (key: string, sector: string, memberGroupIds: string[]) => {
    const name = (names[key] ?? '').trim();
    if (!name) return;
    setApplying(key);
    try {
      await apply.mutateAsync({ name, sector, memberGroupIds });
    } catch { /* toast pelo hook */ } finally { setApplying(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkle className="h-5 w-5 text-primary" weight="fill" /> Sugestões de família</DialogTitle>
          <DialogDescription>
            Grupos soltos com nomes parecidos, no mesmo setor. Nada é aplicado automaticamente — revise o nome e clique em criar.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
        ) : suggestions.length === 0 ? (
          <EmptyState icon={Sparkle} title="Nenhuma sugestão" description="Não encontramos grupos soltos parecidos o bastante para sugerir uma família." />
        ) : (
          <div className="space-y-3">
            {suggestions.map((s, i) => {
              const key = `${s.sector}::${s.suggested_family}::${i}`;
              return (
                <div key={key} className="rounded-lg border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={names[key] ?? s.suggested_family}
                      onChange={(e) => setNames(n => ({ ...n, [key]: e.target.value }))}
                      className="h-9 font-medium uppercase"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 gap-1 shrink-0"
                      disabled={applying === key || apply.isPending}
                      onClick={() => handleApply(key, s.sector, s.member_group_ids)}
                    >
                      {applying === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Criar família
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">{sectorLabel(s.sector)}</span>
                    <span>·</span>
                    {s.member_names.map((n, j) => (
                      <span key={j} className="rounded bg-muted/60 px-1.5 py-0.5">{n}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
