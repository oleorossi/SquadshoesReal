import { useMemo, useState } from 'react';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import {
  collectKnownOrderCodes,
  findIdsMatchingOrderCodes,
  matchesOrderSearch,
  parseOrderCodeList,
  type OrderSearchFields,
} from '@/lib/orderCodeSearch';
import { matchesDeliveryWeek } from '@/lib/deliveryWeekOptions';

export interface OrderListItemBase {
  id: string;
}

/**
 * Combina busca (lista colada OR + ref/cor + texto AND), filtros cliente/semana e
 * marquee persistente pra listas de OP/PV.
 */
export function useOrderListMultiSelect<T extends OrderListItemBase>(
  items: T[],
  getSearchFields: (item: T) => OrderSearchFields & {
    clientName?: string | null;
    deliveryDate?: string | null;
  },
) {
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [weekFilter, setWeekFilter] = useState('all');

  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      const name = (getSearchFields(item).clientName || '').trim();
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const knownCodes = useMemo(
    () =>
      collectKnownOrderCodes(items, (item) => {
        const f = getSearchFields(item);
        return {
          orderNumber: f.orderNumber,
          saleOrderNumber: f.saleOrderNumber,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  );

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const f = getSearchFields(item);
      if (clientFilter !== 'all' && (f.clientName || '').trim() !== clientFilter) {
        return false;
      }
      if (weekFilter !== 'all' && !matchesDeliveryWeek(f.deliveryDate, weekFilter)) {
        return false;
      }
      if (search.trim() && !matchesOrderSearch(search, f, { knownCodes })) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, search, clientFilter, weekFilter, knownCodes]);

  const sel = useMarqueeSelection(filtered, (o) => o.id);

  const pastedCodes = useMemo(
    () => parseOrderCodeList(search, knownCodes),
    [search, knownCodes],
  );
  const matchedCodeIds = useMemo(
    () => findIdsMatchingOrderCodes(items, pastedCodes, (item) => {
      const f = getSearchFields(item);
      return {
        id: item.id,
        orderNumber: f.orderNumber,
        saleOrderNumber: f.saleOrderNumber,
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, pastedCodes],
  );

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((item) => sel.isSelected(item.id));

  const toggleVisible = () => {
    if (allVisibleSelected) sel.deselectVisible();
    else sel.selectAll();
  };

  return {
    search,
    setSearch,
    clientFilter,
    setClientFilter,
    weekFilter,
    setWeekFilter,
    clientOptions,
    filtered,
    sel,
    pastedCodes,
    matchedCodeIds,
    knownCodes,
    allVisibleSelected,
    toggleVisible,
    selectMatched: () => sel.selectMatchingIds(matchedCodeIds),
  };
}
