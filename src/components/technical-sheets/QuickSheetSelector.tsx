import { FileText } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency } from '@/lib/utils';

export interface QuickSheetOption {
  id: string;
  name?: string | null;
  code?: string | null;
  sale_price?: number | string | null;
}

interface Props {
  sheets: readonly QuickSheetOption[];
  onSelect: (id: string) => void;
}

export function QuickSheetSelector({ sheets, onSelect }: Props) {
  const [selectedRef, setSelectedRef] = useState<string | null>(null);

  const sortedSheets = useMemo(
    () => [...sheets].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')),
    [sheets],
  );
  const selectedSheet = useMemo(
    () => sheets.find(sheet => sheet.id === selectedRef) || null,
    [selectedRef, sheets],
  );

  useEffect(() => {
    if (selectedRef && !selectedSheet) setSelectedRef(null);
  }, [selectedRef, selectedSheet]);

  return (
    <div className="flex flex-col gap-3 border-2 border-foreground bg-card p-2.5 sm:flex-row sm:items-center sm:p-3">
      <div className="flex shrink-0 items-center gap-2.5 sm:min-w-[150px]">
        <span className="flex h-8 w-8 items-center justify-center bg-foreground text-background" aria-hidden="true">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Acesso rápido</p>
          <p className="truncate text-xs font-semibold">Abrir por referência</p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={selectedRef || ''} onValueChange={setSelectedRef}>
          <SelectTrigger className="h-9 min-w-0 flex-1 border-foreground/25 bg-background sm:min-w-[260px]" aria-label="Selecionar referência para abrir">
            <SelectValue placeholder="Selecione uma referência" />
          </SelectTrigger>
          <SelectContent>
            {sortedSheets.map(sheet => (
              <SelectItem key={sheet.id} value={sheet.id}>
                {sheet.name} {sheet.code ? `(${sheet.code})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="hidden min-w-[150px] border-l border-border pl-3 lg:block">
          {selectedSheet ? (
            <>
              <p className="truncate font-mono text-[10px] font-semibold" title={selectedSheet.code || 'Sem código interno'}>
                {selectedSheet.code || 'SEM CÓDIGO'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {Number(selectedSheet.sale_price) > 0 ? formatCurrency(Number(selectedSheet.sale_price)) : 'Preço não informado'}
              </p>
            </>
          ) : (
            <p className="font-mono text-[10px] text-muted-foreground">{sheets.length} referências</p>
          )}
        </div>

        <Button
          disabled={!selectedRef}
          onClick={() => selectedRef && onSelect(selectedRef)}
          className="h-9 shrink-0 gap-2 px-4"
        >
          <FileText className="h-4 w-4" />
          Abrir ficha
        </Button>
      </div>
    </div>
  );
}
