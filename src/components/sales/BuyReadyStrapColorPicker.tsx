/**
 * Escolha das tiras compradas prontas sem cadastro, no diálogo de duplicação.
 *
 * Pedido do dono (12/10/2026): *"eu irei selecionar todos os itens que irão com
 * [um] tipo de tira e as que irão com outra"*. Responder item a item não escala
 * — um pedido com 12 itens vira 12 seletores iguais. Aqui as lacunas vêm
 * agrupadas pelo ESCOPO da tira (medida + grupo acabado), onde as cores
 * ofertáveis são as mesmas, e dentro do grupo se marca um conjunto de itens e
 * aplica a cor de uma vez. O ajuste individual continua na própria linha.
 */

import { useMemo, useState } from 'react';
import { Warning as AlertTriangle, Check } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  groupItemStrapColorGaps,
  type ItemStrapColorGap,
} from '@/lib/copySaleOrderStraps';
import { cn } from '@/lib/utils';

interface Props {
  gaps: ItemStrapColorGap[];
  choices: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

export default function BuyReadyStrapColorPicker({ gaps, choices, onChange }: Props) {
  // A seleção é efêmera: serve para aplicar em lote, não é resposta. Quem
  // responde é `choices` — por isso ela não some ao marcar/desmarcar.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkColor, setBulkColor] = useState<Record<string, string>>({});
  const groups = useMemo(() => groupItemStrapColorGaps(gaps), [gaps]);

  const toggle = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const applyToSelected = (scopeKey: string, keys: string[]) => {
    const color = bulkColor[scopeKey];
    if (!color) return;
    const marked = keys.filter((key) => selected.has(key));
    if (marked.length === 0) return;
    onChange({ ...choices, ...Object.fromEntries(marked.map((key) => [key, color])) });
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of marked) next.delete(key);
      return next;
    });
  };

  const pending = gaps.filter((entry) => !choices[entry.key]).length;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-3">
      <div className="flex gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" weight="fill" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-amber-600">
            Tira comprada pronta sem cadastro na cor do pedido
            {pending > 0 && <span className="ml-1 font-normal">· faltam {pending}</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            Marque os itens que levam a mesma tira e aplique de uma vez; repita para os
            demais. Vale para todas as lojas e não altera o pedido de origem.
          </p>
        </div>
      </div>

      {groups.map((group) => {
        const keys = group.entries.map((entry) => entry.key);
        const markedCount = keys.filter((key) => selected.has(key)).length;
        const allMarked = markedCount === keys.length && keys.length > 0;
        return (
          <div key={group.scopeKey} className="rounded border border-border/60 bg-card/60 p-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox
                checked={allMarked}
                onCheckedChange={() => setSelected((prev) => {
                  const next = new Set(prev);
                  if (allMarked) for (const key of keys) next.delete(key);
                  else for (const key of keys) next.add(key);
                  return next;
                })}
                aria-label={`Marcar todos de ${group.groupName}`}
              />
              <span className="text-xs font-mono uppercase font-semibold text-foreground">
                {group.groupName}
              </span>
              <span className="text-xs text-muted-foreground">
                {keys.length} {keys.length === 1 ? 'item' : 'itens'}
              </span>

              {group.options.length === 0 ? (
                <span className="text-xs text-amber-600">
                  nenhuma cor cadastrada — resolva no Hub de Tiras
                </span>
              ) : (
                <div className="ml-auto flex items-center gap-2">
                  <Select
                    value={bulkColor[group.scopeKey] || ''}
                    onValueChange={(value) => setBulkColor(
                      (prev) => ({ ...prev, [group.scopeKey]: value }),
                    )}
                  >
                    <SelectTrigger className="h-8 w-[240px]">
                      <SelectValue placeholder="Cor para os marcados" />
                    </SelectTrigger>
                    <SelectContent>
                      {group.options.map((option) => (
                        <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    disabled={markedCount === 0 || !bulkColor[group.scopeKey]}
                    onClick={() => applyToSelected(group.scopeKey, keys)}
                  >
                    Aplicar a {markedCount}
                  </Button>
                </div>
              )}
            </div>

            {group.entries.map((entry) => {
              const chosen = choices[entry.key];
              const chosenName = group.options.find((option) => option.id === chosen)?.name;
              return (
                <div
                  key={entry.key}
                  className={cn(
                    'flex flex-wrap items-center gap-2 rounded px-1.5 py-1',
                    selected.has(entry.key) && 'bg-muted/50',
                  )}
                >
                  <Checkbox
                    checked={selected.has(entry.key)}
                    onCheckedChange={() => toggle(entry.key)}
                    aria-label={`Marcar ${entry.itemLabel}`}
                  />
                  <span className="text-xs font-semibold text-foreground">{entry.itemLabel}</span>
                  <span className="text-xs font-mono uppercase text-muted-foreground">
                    {entry.gap.strapLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    origem: <span className="line-through">{entry.gap.currentColorName}</span>
                  </span>
                  {chosenName ? (
                    <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-green-600">
                      <Check className="h-3.5 w-3.5" weight="bold" />
                      {chosenName}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-xs font-normal text-muted-foreground"
                        onClick={() => {
                          const next = { ...choices };
                          delete next[entry.key];
                          onChange(next);
                        }}
                      >
                        trocar
                      </Button>
                    </span>
                  ) : group.options.length > 0 && (
                    <Select
                      value=""
                      onValueChange={(value) => onChange({ ...choices, [entry.key]: value })}
                    >
                      <SelectTrigger className="ml-auto h-7 w-[220px]">
                        <SelectValue placeholder="ou escolha só para este" />
                      </SelectTrigger>
                      <SelectContent>
                        {group.options.map((option) => (
                          <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
