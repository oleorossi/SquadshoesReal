import { useMemo, useState } from 'react';
import { Tag, Warning } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchInput } from '@/components/ui/search-input';
import {
  buildPartialLabelPrintRows,
  clampPartialLabelQuantity,
  normalizePartialLabelPrintSelection,
  summarizePartialLabelPrintSelection,
  type PartialLabelPrintGroup,
  type PartialLabelPrintSelection,
} from '@/lib/labelPartialPrint';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

interface PartialPrintSelectionDialogProps {
  groups: PartialLabelPrintGroup[];
  initialSelection: PartialLabelPrintSelection;
  onApply: (selection: PartialLabelPrintSelection) => void;
  onClose: () => void;
}

export function PartialPrintSelectionDialog({
  groups,
  initialSelection,
  onApply,
  onClose,
}: PartialPrintSelectionDialogProps) {
  const allRows = useMemo(() => buildPartialLabelPrintRows(groups), [groups]);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<PartialLabelPrintSelection>(() =>
    normalizePartialLabelPrintSelection(groups, initialSelection));

  const visibleRows = useMemo(() => allRows.filter(row => searchMatchesAllTerms(
    search,
    row.refCode,
    row.refName,
    row.color,
    row.size,
    row.orderNumbers.join(' '),
  )), [allRows, search]);
  const summary = summarizePartialLabelPrintSelection(groups, draft);
  const groupsWithGrade = new Set(allRows.map(row => row.groupKey));
  const groupsWithoutGrade = groups.filter(group => !groupsWithGrade.has(group.groupKey));
  const visibleSelectedCount = visibleRows.filter(row => (draft[row.groupKey]?.[row.size] || 0) > 0).length;
  const allVisibleSelected = visibleRows.length > 0 && visibleSelectedCount === visibleRows.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;

  function setRowSelected(groupKey: string, size: string, available: number, checked: boolean) {
    setDraft(current => {
      const next = { ...current };
      const group = { ...(next[groupKey] || {}) };
      if (checked) group[size] = available;
      else delete group[size];
      if (Object.keys(group).length > 0) next[groupKey] = group;
      else delete next[groupKey];
      return next;
    });
  }

  function setRowQuantity(groupKey: string, size: string, available: number, rawValue: string) {
    setDraft(current => ({
      ...current,
      [groupKey]: {
        ...(current[groupKey] || {}),
        [size]: clampPartialLabelQuantity(rawValue, available),
      },
    }));
  }

  function setAllVisible(checked: boolean) {
    setDraft(current => {
      const next = { ...current };
      for (const row of visibleRows) {
        const group = { ...(next[row.groupKey] || {}) };
        if (checked) {
          if (!(group[row.size] > 0)) group[row.size] = row.available;
        } else {
          delete group[row.size];
        }
        if (Object.keys(group).length > 0) next[row.groupKey] = group;
        else delete next[row.groupKey];
      }
      return next;
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90dvh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="border-b border-border px-5 py-5 sm:px-6">
          <div className="flex items-center gap-2 pr-8">
            <Tag className="h-5 w-5 shrink-0 text-primary" />
            <DialogTitle>Reimpressão parcial</DialogTitle>
          </div>
          <DialogDescription className="max-w-3xl pt-1 text-left">
            Marque somente as numerações das etiquetas perdidas e informe quantas unidades precisam ser refeitas.
            A OP e as quantidades do pedido não serão alteradas.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 border-b border-border bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:px-6">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar referência, cor, numeração ou OP…"
            resultCount={visibleRows.length}
            totalCount={allRows.length}
            className="min-w-0 flex-1"
            inputClassName="h-9"
            enterKeyHint="search"
            onKeyDown={event => {
              // Enter aqui é apenas a ação de busca do teclado. Sem o bloqueio,
              // o atalho global do Dialog confirmaria a reimpressão sem o clique.
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={visibleRows.length === 0}
              onClick={() => setAllVisible(true)}
            >
              Selecionar exibidos
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              disabled={summary.selectedRows === 0}
              onClick={() => setDraft({})}
            >
              Limpar seleção
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {groupsWithoutGrade.length > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
              <Warning className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-xs">
                {groupsWithoutGrade.length} {groupsWithoutGrade.length === 1 ? 'item selecionado está' : 'itens selecionados estão'} sem grade por numeração e não pode ser reimpresso parcialmente.
              </p>
            </div>
          )}

          {allRows.length > 0 && (
            <div className="mb-2 flex items-center gap-3 rounded-sm border border-border bg-background px-3 py-2 md:hidden">
              <Checkbox
                id="partial-print-select-all-mobile"
                checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                onCheckedChange={checked => setAllVisible(checked === true)}
                disabled={visibleRows.length === 0}
              />
              <Label htmlFor="partial-print-select-all-mobile" className="text-xs font-medium">
                Selecionar todas as numerações exibidas
              </Label>
            </div>
          )}

          <div className="hidden grid-cols-[2rem_minmax(11rem,1.4fr)_minmax(8rem,1fr)_4.5rem_6rem_7rem] items-center gap-3 border-b-[1.5px] border-foreground px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-foreground md:grid">
            <Checkbox
              id="partial-print-select-all"
              checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
              onCheckedChange={checked => setAllVisible(checked === true)}
              disabled={visibleRows.length === 0}
              aria-label="Selecionar todas as numerações exibidas"
            />
            <span>Referência</span>
            <span>Cor / OP</span>
            <span className="text-center">Tam.</span>
            <span className="text-right">Qtd. pedido</span>
            <span className="text-center">Qtd. imprimir</span>
          </div>

          <div className="divide-y divide-border border-b border-border">
            {visibleRows.map((row, index) => {
              const checked = (draft[row.groupKey]?.[row.size] || 0) > 0;
              const quantity = checked ? draft[row.groupKey][row.size] : row.available;
              const checkboxId = `partial-print-row-${index}`;
              return (
                <div
                  key={row.key}
                  data-state={checked ? 'selected' : undefined}
                  className="grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_6.5rem] items-center gap-2 px-3 py-3 transition-colors data-[state=selected]:bg-primary/5 md:grid-cols-[2rem_minmax(11rem,1.4fr)_minmax(8rem,1fr)_4.5rem_6rem_7rem] md:gap-3"
                >
                  <Checkbox
                    id={checkboxId}
                    checked={checked}
                    onCheckedChange={value => setRowSelected(row.groupKey, row.size, row.available, value === true)}
                    aria-label={`Selecionar ${row.refCode || row.refName}, tamanho ${row.size}, até ${row.available} etiquetas`}
                  />
                  <Label htmlFor={checkboxId} className="min-w-0 cursor-pointer">
                    <span className="block truncate text-sm font-semibold text-foreground">{row.refCode || row.refName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.refName || 'Sem nome'}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground md:hidden">
                      {row.color || 'Sem cor'} · {row.available.toLocaleString('pt-BR')} no pedido
                    </span>
                  </Label>
                  <div className="hidden min-w-0 md:block">
                    <span className="block truncate text-xs font-medium text-foreground">{row.color || 'Sem cor'}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{row.orderNumbers.join(', ') || 'Sem OP'}</span>
                  </div>
                  <Badge variant="outline" className="justify-center font-mono text-sm tabular-nums">
                    {row.size}
                  </Badge>
                  <span className="hidden text-right font-mono text-sm tabular-nums text-foreground md:block">
                    {row.available.toLocaleString('pt-BR')}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    max={row.available}
                    step={1}
                    inputMode="numeric"
                    value={quantity}
                    disabled={!checked}
                    aria-label={`Quantidade a reimprimir de ${row.refCode || row.refName}, tamanho ${row.size}`}
                    onChange={event => setRowQuantity(row.groupKey, row.size, row.available, event.target.value)}
                    className="h-9 text-center font-mono tabular-nums"
                  />
                </div>
              );
            })}
          </div>

          {visibleRows.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {allRows.length === 0
                ? 'Os itens selecionados não possuem grade por numeração.'
                : `Nenhuma numeração encontrada para “${search}”.`}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border bg-background px-5 py-4 sm:items-center sm:justify-between sm:px-6">
          <div className="mr-auto flex flex-wrap items-center gap-2" aria-live="polite">
            <Badge variant="secondary">
              {summary.selectedRows} {summary.selectedRows === 1 ? 'numeração' : 'numerações'}
            </Badge>
            <strong className="text-sm tabular-nums text-foreground">
              {summary.totalLabels.toLocaleString('pt-BR')} {summary.totalLabels === 1 ? 'etiqueta' : 'etiquetas'}
            </strong>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            type="button"
            data-dialog-primary="true"
            disabled={summary.totalLabels === 0}
            onClick={() => onApply(normalizePartialLabelPrintSelection(groups, draft))}
          >
            Usar reimpressão parcial
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
