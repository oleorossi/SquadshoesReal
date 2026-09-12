import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { SearchLocatorStrip } from '@/components/ui/searchable-select';
import { Check, CaretUpDown as ChevronsUpDown, User } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
  SEARCH_RENDER_CAP,
  capSearchResults,
  searchMatchesAllTerms,
  searchRefineHint,
  rankBySearchScore,
} from '@/lib/searchUtils';
import { HighlightMatch } from '@/components/ui/highlight-match';
import type { Employee } from '@/hooks/useEmployees';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface EmployeeComboboxProps {
  value: string;
  onChange: (employeeId: string) => void;
  employees: Employee[];
  /** Saldo de vales em aberto por funcionário — exibido como badge no item. */
  openBalanceByEmployee?: Map<string, number>;
  placeholder?: string;
  className?: string;
}

const roleLine = (e: Employee) =>
  [e.role, e.department].map(s => (s || '').trim()).filter(Boolean).join(' · ') || 'Sem cargo definido';

/**
 * Seletor de funcionário com busca (cargo/setor/matrícula), acento-insensível.
 * Espelha o contrato do SearchableSelect (faixa N de M + RENDER_CAP). Mostra o
 * saldo aberto de vales no item, pra dar contexto antes de lançar um novo adiantamento.
 */
export function EmployeeCombobox({
  value, onChange, employees, openBalanceByEmployee, placeholder = 'Selecione o funcionário...', className,
}: EmployeeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const active = useMemo(
    () => employees.filter(e => e.active).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [employees],
  );

  const selected = useMemo(() => employees.find(e => e.id === value), [employees, value]);

  const filtered = useMemo(() => {
    if (!search.trim()) return active;
    const hits = active.filter(e => searchMatchesAllTerms(search, e.name, e.role, e.department, e.external_id));
    return rankBySearchScore(hits, search, e => e.name, e => e.role, e => e.department, e => e.external_id);
  }, [active, search]);

  const { visible, capped, totalMatched, cap } = useMemo(
    () => capSearchResults(filtered, SEARCH_RENDER_CAP),
    [filtered],
  );

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline" role="combobox" aria-expanded={open}
          className={cn('h-9 w-full justify-between text-sm font-normal', className)}
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{selected.name}</span>
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">{roleLine(selected)}</span>
            </span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <User className="h-3.5 w-3.5" /> {placeholder}
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[300px] p-0" align="start">
        <Command shouldFilter={false} label="Buscar por nome, cargo, setor ou matrícula...">
          <SearchLocatorStrip
            label="Localizar funcionário"
            matchedCount={totalMatched}
            totalCount={active.length}
            hasQuery={!!search.trim()}
          />
          <CommandInput placeholder="Buscar por nome, cargo, setor ou matrícula..." value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>
              {search ? (
                <span className="flex flex-col items-center gap-2">
                  <span>Nenhum resultado para "{search}"</span>
                  <Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>
                </span>
              ) : (
                'Nenhum funcionário encontrado.'
              )}
            </CommandEmpty>
            <CommandGroup heading="Funcionários ativos">
              {visible.map(e => {
                const openBalance = openBalanceByEmployee?.get(e.id) ?? 0;
                return (
                  <CommandItem
                    key={e.id} value={e.id}
                    onSelect={() => { onChange(e.id); setOpen(false); setSearch(''); }}
                    className="gap-2"
                  >
                    <Check className={cn('h-4 w-4 shrink-0', value === e.id ? 'opacity-100' : 'opacity-0')} />
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm"><HighlightMatch text={e.name} term={search} /></span>
                        <span className="truncate text-xs text-muted-foreground"><HighlightMatch text={roleLine(e)} term={search} /></span>
                      </div>
                      {openBalance > 0 && (
                        <Badge
                          variant="outline"
                          className="shrink-0 gap-1 border-rose-500/20 bg-rose-500/10 text-[10px] font-medium tabular-nums text-rose-600"
                          title="Saldo de vales em aberto"
                        >
                          {fmt(openBalance)}
                        </Badge>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
              {capped && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {searchRefineHint(totalMatched, cap)}
                </div>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
