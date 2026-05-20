import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, Plus, FloppyDisk as Save, Trash as Trash2, Link as Link2, Warning as AlertTriangle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  useSoleConjugations,
  useUpsertSoleConjugation,
  useDeleteSoleConjugation,
} from '@/hooks/useSoleConjugations';

interface Props {
  /** product_groups.id do solado */
  soleGroupId: string | null;
  /** Faixa atual definida no editor (para sugerir conjugações por padrão) */
  sizeFrom: number | null;
  sizeTo: number | null;
}

type DraftRow = {
  id?: string;
  size_key: string;
  sizes: number[];
  display_order: number;
};

/**
 * Editor de numerações conjugadas para um GRUPO de solado.
 * Conjugações ficam atreladas ao product_groups.id, ou seja, se aplicam a todas
 * as variantes (cores) deste solado. Ex.: 23/24, 25/26.
 *
 * O usuário marca o toggle "Tem numeração conjugada"; ao habilitar, pode
 * adicionar pares (ou trios) usando os tamanhos contidos na faixa atual.
 */
export function SoleSizeConjugationsEditor({ soleGroupId, sizeFrom, sizeTo }: Props) {
  const { data: existing = [], isLoading } = useSoleConjugations(soleGroupId);
  const upsert = useUpsertSoleConjugation();
  const remove = useDeleteSoleConjugation();

  const [enabled, setEnabled] = useState(false);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  // Stable signature of server rows — re-syncs when an edit changes a value but not the count.
  const existingKey = useMemo(
    () =>
      existing
        .map((c) => `${c.id}:${c.size_key}:${[...c.sizes].sort((a, b) => a - b).join(',')}`)
        .join('|'),
    [existing],
  );

  // Sync from server state
  useEffect(() => {
    if (existing.length > 0) {
      setEnabled(true);
      setDrafts(existing.map((c) => ({
        id: c.id,
        size_key: c.size_key,
        sizes: [...c.sizes].sort((a, b) => a - b),
        display_order: c.display_order,
      })));
    } else {
      setEnabled(false);
      setDrafts([]);
    }
    // existingKey is a stable signature of the existing rows (id+size_key+sizes).
    // Keying on length alone misses edits that keep the count constant.
  }, [existingKey, soleGroupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableSizes = useMemo(() => {
    if (sizeFrom == null || sizeTo == null || sizeTo < sizeFrom) return [] as number[];
    return Array.from({ length: sizeTo - sizeFrom + 1 }, (_, i) => sizeFrom + i);
  }, [sizeFrom, sizeTo]);

  const usedSizes = useMemo(() => {
    const s = new Set<number>();
    for (const d of drafts) d.sizes.forEach((n) => s.add(n));
    return s;
  }, [drafts]);

  const buildKeyFromSizes = (sizes: number[]) =>
    [...sizes].sort((a, b) => a - b).join('/');

  const addPair = () => {
    if (availableSizes.length === 0) {
      toast.error('Defina a faixa de numeração antes de criar conjugações');
      return;
    }
    // Sugere o próximo par não usado
    const remaining = availableSizes.filter((s) => !usedSizes.has(s));
    const suggested = remaining.slice(0, 2);
    if (suggested.length < 2) {
      toast.info('Não há tamanhos suficientes livres na faixa para um novo par');
      return;
    }
    setDrafts((prev) => [
      ...prev,
      {
        size_key: buildKeyFromSizes(suggested),
        sizes: suggested,
        display_order: prev.length,
      },
    ]);
  };

  const toggleSizeOnDraft = (idx: number, size: number) => {
    setDrafts((prev) => prev.map((d, i) => {
      if (i !== idx) return d;
      const has = d.sizes.includes(size);
      const nextSizes = has ? d.sizes.filter((s) => s !== size) : [...d.sizes, size].sort((a, b) => a - b);
      return { ...d, sizes: nextSizes, size_key: buildKeyFromSizes(nextSizes) };
    }));
  };

  const removeDraft = async (idx: number) => {
    const d = drafts[idx];
    if (d.id && soleGroupId) {
      try {
        await remove.mutateAsync({ id: d.id, soleGroupId });
      } catch {
        return;
      }
    }
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleToggle = async (next: boolean) => {
    if (!next) {
      // Desliga: remover todas as conjugações persistidas
      if (drafts.some((d) => d.id) && soleGroupId) {
        const ok = window.confirm('Desativar conjugações vai remover TODAS as conjugações cadastradas para este solado. Confirma?');
        if (!ok) return;
        for (const d of drafts) {
          if (d.id) await remove.mutateAsync({ id: d.id, soleGroupId });
        }
      }
      setDrafts([]);
    }
    setEnabled(next);
  };

  const handleSaveAll = async () => {
    if (!soleGroupId) {
      toast.error('Salve o grupo de produtos primeiro');
      return;
    }
    // Validações
    const seen = new Set<number>();
    for (const d of drafts) {
      if (d.sizes.length < 2) {
        toast.error(`A conjugação "${d.size_key || '(sem tamanhos)'}" precisa ter pelo menos 2 tamanhos`);
        return;
      }
      for (const s of d.sizes) {
        if (seen.has(s)) {
          toast.error(`Tamanho ${s} aparece em mais de uma conjugação`);
          return;
        }
        seen.add(s);
      }
    }

    try {
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        await upsert.mutateAsync({
          id: d.id,
          sole_group_id: soleGroupId,
          size_key: d.size_key,
          sizes: d.sizes,
          display_order: i,
        });
      }
      toast.success('Conjugações salvas');
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err.message}`);
    }
  };

  if (!soleGroupId) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Defina um <strong>Grupo de produtos</strong> para este solado (na aba "Dados do Grupo") para poder cadastrar numerações conjugadas.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          <div>
            <Label className="text-xs font-semibold">Tem numeração conjugada</Label>
            <p className="text-[11px] text-muted-foreground">
              Ex.: solados onde 23 e 24 compartilham o mesmo molde — o estoque é único.
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggle} disabled={isLoading} />
      </div>

      {enabled && (
        <div className="space-y-3">
          {drafts.length === 0 && (
            <div className="text-xs text-muted-foreground italic">
              Nenhuma conjugação cadastrada. Clique em "Adicionar conjugação".
            </div>
          )}

          {drafts.map((d, idx) => (
            <div key={idx} className="rounded-md border p-3 space-y-2 bg-card">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">
                    {d.size_key || '(vazio)'}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {d.sizes.length} tamanho{d.sizes.length === 1 ? '' : 's'}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  onClick={() => removeDraft(idx)}
                  title="Remover conjugação"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div>
                <Label className="text-[11px] text-muted-foreground">Tamanhos conjugados</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {availableSizes.map((s) => {
                    const selected = d.sizes.includes(s);
                    const usedElsewhere = !selected && drafts.some((other, i) => i !== idx && other.sizes.includes(s));
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => !usedElsewhere && toggleSizeOnDraft(idx, s)}
                        disabled={usedElsewhere}
                        className={`h-7 min-w-[34px] rounded border px-2 text-xs font-mono transition-colors ${
                          selected
                            ? 'bg-primary text-primary-foreground border-primary'
                            : usedElsewhere
                            ? 'bg-muted/40 text-muted-foreground/50 border-border cursor-not-allowed'
                            : 'bg-background hover:bg-muted/60 border-border'
                        }`}
                        title={usedElsewhere ? 'Já usado em outra conjugação' : ''}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label className="text-[11px] text-muted-foreground">Identificador (auto)</Label>
                <Input
                  value={d.size_key}
                  readOnly
                  className="mt-1 h-8 font-mono text-xs bg-muted/30"
                />
              </div>
            </div>
          ))}

          <div className="flex justify-between gap-2">
            <Button variant="outline" size="sm" onClick={addPair} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Adicionar conjugação
            </Button>
            <Button size="sm" onClick={handleSaveAll} disabled={upsert.isPending} className="gap-1">
              {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar conjugações
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}