import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const pvCard = read('src/components/sale-orders/PvServiceOrdersCard.tsx');
const globalSearch = read('src/components/layout/GlobalSearch.tsx');
const serviceOrderHooks = read('src/hooks/useContractors.ts');
const generateHooks = read('src/hooks/useGenerateOpServiceOrders.ts');

describe('Descoberta completa das OS de um PV', () => {
  it('cobre todas as identidades persistidas no cabeçalho e nas linhas', () => {
    expect(pvCard).toContain('source_sale_order_id.eq.${saleOrderId}');
    expect(pvCard).toContain('sale_order_id.eq.${saleOrderId}');
    expect(pvCard).toContain(".contains('linked_sale_order_ids', [saleOrderId])");
    expect(pvCard).toContain(".in('source_sale_order_item_id', itemIds)");
    expect(pvCard).toContain(".overlaps('selected_sale_order_item_ids', itemIds)");
    expect(pvCard).toContain(".from('service_order_items')");
    expect(pvCard).toContain('sale_order_id.eq.${saleOrderId},order_id.in.');
    expect(pvCard).toContain('dedupeAndSortPvServiceOrders');
  });

  it('atribui contêineres por linha e não exibe total global como se fosse do PV', () => {
    expect(pvCard).toContain('attributeServiceOrderToPv');
    expect(pvCard).toContain("attribution.totalValue == null ? '—'");
    expect(pvCard).toContain('Totais compartilhados sem rateio não entram na soma');
    expect(pvCard).toContain('Total ativo atribuível ao PV');
  });

  it('não transforma falha de vínculo em ausência silenciosa de OS', () => {
    expect(pvCard).toContain('isError, error, refetch');
    expect(pvCard).toContain('Não foi possível conferir as OS deste pedido.');
    expect(pvCard).toContain('Tentar novamente');
  });
});

describe('Busca global — isolamento por permissão de domínio', () => {
  it('mantém queries, fontes e chaves independentes para Terceirizados e Tiras', () => {
    expect(globalSearch).toContain("queryKey: ['global-search-contractor-service-orders', searchTerm]");
    expect(globalSearch).toContain("queryKey: ['global-search-strap-service-orders', searchTerm]");
    expect(globalSearch).toContain("enabled: searchEnabled && inScope('os') && canSearchContractorServiceOrders");
    expect(globalSearch).toContain("enabled: searchEnabled && inScope('os') && canSearchStrapServiceOrders");
    expect(globalSearch).toContain(".from('v_non_strap_service_orders')");
    expect(globalSearch).toContain(".from('v_strap_service_order_items_operational')");
    expect(globalSearch).not.toContain('const allServiceOrders');
  });

  it('aplica um teto próprio a cada domínio antes de renderizar resultados', () => {
    expect(globalSearch).toContain('const GLOBAL_SERVICE_ORDER_LIMIT = 6');

    const contractorBlock = globalSearch.slice(
      globalSearch.indexOf("queryKey: ['global-search-contractor-service-orders'"),
      globalSearch.indexOf("queryKey: ['global-search-strap-service-orders'"),
    );
    const strapBlock = globalSearch.slice(
      globalSearch.indexOf("queryKey: ['global-search-strap-service-orders'"),
      globalSearch.indexOf("queryKey: ['global-search-nfe'"),
    );
    expect(contractorBlock).toContain('.limit(GLOBAL_SERVICE_ORDER_LIMIT)');
    expect(strapBlock).toContain('.limit(GLOBAL_SERVICE_ORDER_LIMIT)');
    expect(strapBlock).toContain('.slice(0, GLOBAL_SERVICE_ORDER_LIMIT)');
  });

  it('restringe a contingência pré-migration por erro de relation e filtra localmente', () => {
    const strapBlock = globalSearch.slice(
      globalSearch.indexOf("queryKey: ['global-search-strap-service-orders'"),
      globalSearch.indexOf("queryKey: ['global-search-nfe'"),
    );
    expect(strapBlock).toContain(".from('v_strap_service_orders')");
    expect(strapBlock).toContain("isMissingPostgrestRelation(legacyError, 'v_strap_service_orders')");
    expect(strapBlock).toContain(".from('service_orders')");
    expect(strapBlock).toContain('.filter((row: any) => isStrapServiceOrder(row))');
    expect(strapBlock).toContain('.or(legacySearchParts.join');
  });
});

describe('Atualização do card do PV', () => {
  it('invalida o prefixo do card depois dos escritores canônicos e manuais de OS', () => {
    expect(generateHooks.match(/queryKey: \['pv_service_orders'\]/g)?.length).toBeGreaterThanOrEqual(2);
    expect(serviceOrderHooks.match(/queryKey: \['pv_service_orders'\]/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
