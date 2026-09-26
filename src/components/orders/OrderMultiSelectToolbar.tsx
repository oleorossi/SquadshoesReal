import type { ReactNode } from 'react';
import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { looksLikeOrderCodeList } from '@/lib/orderCodeSearch';
import { getDeliveryWeekOptions } from '@/lib/deliveryWeekOptions';
import { CheckSquare, Square } from '@phosphor-icons/react';

export interface OrderMultiSelectToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  resultCount?: number;
  totalCount?: number;
  /** Clientes presentes na lista carregada (não filtrada). */
  clientOptions: string[];
  clientFilter: string;
  onClientFilterChange: (value: string) => void;
  weekFilter: string;
  onWeekFilterChange: (value: string) => void;
  /** Filtros extras da tela (status, PV dropdown, etc.). */
  extraFilters?: ReactNode;
  allVisibleSelected: boolean;
  visibleCount: number;
  onToggleVisible: () => void;
  /** Quantos ids a lista colada casaria (pra habilitar o botão). */
  matchedCodeCount: number;
  onSelectMatched: () => void;
  className?: string;
}

/**
 * Barra compartilhada de busca + seleção em listas de OP/PV.
 * Campo único: colar ≥2 códigos (quebra/`,`/`;`/`/`) ativa OR exato e o
 * botão “Selecionar os que bateram”.
 */
export function OrderMultiSelectToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Buscar por OP, PV, cliente, referência, cor…',
  resultCount,
  totalCount,
  clientOptions,
  clientFilter,
  onClientFilterChange,
  weekFilter,
  onWeekFilterChange,
  extraFilters,
  allVisibleSelected,
  visibleCount,
  onToggleVisible,
  matchedCodeCount,
  onSelectMatched,
  className,
}: OrderMultiSelectToolbarProps) {
  const weekOptions = getDeliveryWeekOptions();
  const showSelectMatched = looksLikeOrderCodeList(search);

  return (
    <div className={className ?? 'flex flex-wrap items-center gap-2'}>
      <div className="min-w-[220px] flex-1">
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          resultCount={resultCount}
          totalCount={totalCount}
        />
      </div>

      {showSelectMatched && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-9 gap-1.5"
          disabled={matchedCodeCount === 0}
          onClick={onSelectMatched}
          title="Marca todas as linhas cujo OP/PV casa exatamente com a lista colada"
        >
          <CheckSquare className="h-4 w-4" />
          Selecionar os que bateram
          {matchedCodeCount > 0 ? ` (${matchedCodeCount})` : ''}
        </Button>
      )}

      <Select value={clientFilter} onValueChange={onClientFilterChange}>
        <SelectTrigger className="h-9 w-[180px]">
          <SelectValue placeholder="Cliente" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os clientes</SelectItem>
          {clientOptions.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={weekFilter} onValueChange={onWeekFilterChange}>
        <SelectTrigger className="h-9 w-[180px]">
          <SelectValue placeholder="Semana" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as semanas</SelectItem>
          {weekOptions.map((w) => (
            <SelectItem key={w.value} value={w.value}>
              {w.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {extraFilters}

      <Button
        type="button"
        size="sm"
        variant={allVisibleSelected ? 'default' : 'outline'}
        className="h-9 gap-1.5"
        disabled={visibleCount === 0}
        onClick={onToggleVisible}
      >
        {allVisibleSelected ? (
          <Square className="h-4 w-4" />
        ) : (
          <CheckSquare className="h-4 w-4" />
        )}
        {allVisibleSelected ? 'Desmarcar visíveis' : `Marcar visíveis (${visibleCount})`}
      </Button>
    </div>
  );
}
