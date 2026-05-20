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

  // Tamanhos DENTRO do range atual do solado.
  const inRangeSizes = useMemo(() => {
    if (sizeFrom == null || sizeTo == null || sizeTo < sizeFrom) return [] as number[];
    return Array.from({ length: sizeTo - sizeFrom + 1 }, (_, i) => sizeFrom + i);
  }, [sizeFrom, sizeTo]);

  // Tamanhos vizinhos FORA do range (até 4 abaixo + 4 acima). Permite cadastrar
  // conjugações que extrapolam o range — ao salvar, o range do solado é
  // automaticamente expandido. Origem: 20/05/2026 — user queria cadastrar
  // 33/34 (33 fora do range 34-40) e 39/40 (dentro) sem ter que editar o
  // range manualmente em outra tela primeiro.
  const availableSizes = useMemo(() => {
    if (sizeFrom == null || sizeTo == null || sizeTo < sizeFrom) return [] as number[];
    const before = Array.from({ length: 4 }, (_, i) => sizeFrom - 4 + i).filter(s => s >= 15);
    const after = Array.from({ length: 4 }, (_, i) => sizeTo + 1 + i).filter(s => s <= 50);
    return [...before, ...inRangeSizes, ...after];
  }, [sizeFrom, sizeTo, inRangeSizes]);

  // Tamanhos atualmente usados em DRAFTS que estão FORA do range — vão exigir
  // expansão do solado no save. Mostrados em aviso âmbar.
  const draftsOutOfRange = useMemo(() => {
    const out: number[] = [];
    for (const d of drafts) {
      for (const s of d.sizes) {
        if (sizeFrom == null || sizeTo == null || s < sizeFrom || s > sizeTo) out.push(s);
      }
    }
    return Array.from(new Set(out)).sort((a, b) => a - b);
  }, [drafts, sizeFrom, sizeTo]);

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
    // Cria draft VAZIO — user escolhe quais tamanhos compõem a conjugação
    // clicando nos botões abaixo. Antes auto-sugeria os 2 primeiros disponíveis
    // (ex: 31, 32 mesmo o user querendo 33/34) — atrapalhava mais do que
    // ajudava porque o user sempre tinha que desmarcar antes de marcar
    // os corretos. Reportado em 20/05/2026.
    setDrafts((prev) => [
      ...prev,
      {
        size_key: '',
        sizes: [],
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
      // 1) Expande o range do solado se algum draft tem tamanho fora do range
      //    atual. Atualiza products.stock_grade de TODAS as variantes (cores)
      //    do grupo — assim débito/reserva por numeração continua íntegro.
      if (draftsOutOfRange.length > 0 && sizeFrom != null && sizeTo != null) {
        const newFrom = Math.min(sizeFrom, ...draftsOutOfRange);
        const newTo = Math.max(sizeTo, ...draftsOutOfRange);
        const { data: groupProducts, error: pErr } = await (supabase as any)
          .from('products')
          .select('id, stock_grade')
          .eq('group_id', soleGroupId)
          .eq('category', 'Solado')
          .eq('active', true);
        if (pErr) throw pErr;
        for (const prod of (groupProducts || [])) {
          const grade = { ...(prod.stock_grade || {}) };
          grade._size_from = newFrom;
          grade._size_to = newTo;
          // Garante key 0 nos tamanhos novos pra grade ficar completa
          for (let s = newFrom; s <= newTo; s++) {
            if (grade[String(s)] == null) grade[String(s)] = 0;
          }
          const { error: uErr } = await (supabase as any)
            .from('products')
            .update({ stock_grade: grade })
            .eq('id', prod.id);
          if (uErr) throw uErr;
        }
        toast.info(`Range expandido: ${sizeFrom}-${sizeTo} → ${newFrom}-${newTo}`);
      }

      // 2) Persiste as conjugações
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

          {draftsOutOfRange.length > 0 && sizeFrom != null && sizeTo != null && (() => {
            const newFrom = Math.min(sizeFrom, ...draftsOutOfRange);
            const newTo = Math.max(sizeTo, ...draftsOutOfRange);
            return (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="text-[11px] text-amber-700 dark:text-amber-400">
                  <strong>Range vai ser expandido ao salvar:</strong>{' '}
                  <span className="font-mono">{sizeFrom}–{sizeTo}</span> →{' '}
                  <span className="font-mono font-bold">{newFrom}–{newTo}</span>{' '}
                  (tamanhos fora do range: {draftsOutOfRange.join(', ')})
                </div>
              </div>
            );
          })()}

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
                    const outOfRange = sizeFrom != null && sizeTo != null && (s < sizeFrom || s > sizeTo);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => !usedElsewhere && toggleSizeOnDraft(idx, s)}
                        disabled={usedElsewhere}
                        className={`h-7 min-w-[34px] rounded border px-2 text-xs font-mono transition-colors ${
                          selected
                            ? outOfRange
                              ? 'bg-amber-500 text-white border-amber-600'
                              : 'bg-primary text-primary-foreground border-primary'
                            : usedElsewhere
                            ? 'bg-muted/40 text-muted-foreground/50 border-border cursor-not-allowed'
                            : outOfRange
                            ? 'bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                            : 'bg-background hover:bg-muted/60 border-border'
                        }`}
                        title={usedElsewhere ? 'Já usado em outra conjugação' : outOfRange ? 'Fora do range atual — vai expandir ao salvar' : ''}
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