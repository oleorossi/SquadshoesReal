/**
 * DensityAudit — medição DEV do pacote de densificação (2026-10).
 *
 * Espelha a geometria de Pedidos de Venda (sidebar 200px + header compact +
 * SalesOperationsRail + tabela 1 linha) com fixtures, sem login/Supabase.
 * Só existe em import.meta.env.DEV (ver DESIGN_PREVIEW_ROUTES em App.tsx).
 *
 * Puppeteer / agent: abrir /density-audit em 1440×900 e ler
 * `#density-audit-visible-rows` (atualizado no resize).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import SalesOperationsRail from '@/components/sale-orders/SalesOperationsRail';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
const FIXTURE_ROWS = Array.from({ length: 16 }, (_, i) => ({
  id: `pv-${i + 1}`,
  order: `PV-00${180 - i}`,
  created: `${14 - (i % 10)}/09/2026`,
  client: i % 3 === 0 ? 'CALCADOS RUBIA LTDA' : i % 3 === 1 ? 'PONTO MIX CONFECCOES' : 'DISTRIBUIDORA SUL',
  cnpj: `${10 + i}.123.456/0001-${20 + i}`,
  city: i % 2 === 0 ? 'Novo Hamburgo/RS' : 'São Paulo/SP',
  total: (7500 + i * 413).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  status: i % 4 === 0 ? 'Aprovado' : 'Em Produção',
  pairs: 120 + i * 12,
  deadline: `${20 + (i % 8)}/10/2026`,
}));

export default function DensityAudit() {
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [visibleRows, setVisibleRows] = useState(0);
  const [search, setSearch] = useState('');

  useLayoutEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const viewportBottom = window.innerHeight;
      const rows = wrap.querySelectorAll<HTMLElement>('tbody tr[data-audit-row]');
      let count = 0;
      rows.forEach((row) => {
        const r = row.getBoundingClientRect();
        if (r.top >= 0 && r.bottom <= viewportBottom + 0.5) count += 1;
      });
      setVisibleRows(count);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', measure);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex" data-density-audit>
      {/* Sidebar mock — mesmas larguras do AppLayout densificado */}
      <aside className="hidden md:flex w-[200px] shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex-col">
        <div className="px-3 py-2 border-b border-sidebar-border">
          <p className="ed-display text-lg leading-none">SQUAD</p>
          <p className="ed-eyebrow text-sidebar-muted mt-1">Gestão Industrial</p>
        </div>
        <nav className="p-2 space-y-0.5 text-[12px]">
          {['Painel', 'Pedidos de Venda', 'Estoque', 'Kanban'].map((label, i) => (
            <div
              key={label}
              className={
                i === 1
                  ? 'border-l-[3px] border-primary pl-[10px] pr-3 py-1 font-semibold'
                  : 'border-l-2 border-transparent px-3 py-1 text-sidebar-foreground/60'
              }
            >
              {label}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="hidden md:flex border-b border-border/40 h-9 items-center px-3 md:px-4 lg:px-6 text-xs text-muted-foreground">
          Home · COMERCIAL · PEDIDOS DE VENDA
        </div>

        <main className="flex-1 w-full px-4 md:px-4 lg:px-6 xl:px-8 2xl:px-10 py-4 overflow-auto">
          <div className="w-full space-y-3">
            <EditorialPageHeader
              density="compact"
              sectionLabel="COMERCIAL · PV"
              title="Pedidos de Venda"
              description="Auditoria DEV de densidade — fixtures, sem dados reais"
              actions={
                <>
                  <Button size="sm" variant="outline">Pendências</Button>
                  <Button size="sm">+ Novo Pedido</Button>
                  <Button size="sm" variant="outline">Gerar OPs</Button>
                </>
              }
            />

            <div className="flex items-center gap-1 overflow-x-auto border-b" role="tablist">
              <button type="button" className="px-4 py-2 text-sm font-medium border-b-2 border-primary text-primary">
                Pedidos Ativos <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">10</Badge>
              </button>
              <button type="button" className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground">
                Faturados / Sem NF <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">58</Badge>
              </button>
              <button type="button" className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground">
                Cancelados <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">5</Badge>
              </button>
            </div>

            <SalesOperationsRail
              scopeLabel="Pedidos ativos"
              orderCount={10}
              pairs={1840}
              drafts={0}
              approved={0}
              inProduction={10}
              deadlineRisk={10}
              total="R$ 75.394,80"
            />

            <div className="flex flex-col gap-2 rounded-lg border bg-card p-2 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[16rem] flex-[1_1_32rem] max-w-2xl">
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="Buscar PV, cliente, ref…"
                    totalCount={FIXTURE_ROWS.length}
                  />
                </div>
                <Button size="sm" variant="outline">Filtros</Button>
                <span className="ml-auto text-[10px] font-mono uppercase text-muted-foreground">10 PVs visíveis</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Viewport audit · meta ≥10 linhas totalmente visíveis</span>
              <span
                id="density-audit-visible-rows"
                className="font-mono font-bold text-foreground"
                data-visible-rows={visibleRows}
              >
                {visibleRows} linhas visíveis
              </span>
            </div>

            <div ref={tableWrapRef} className="rounded-lg border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Cidade</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Pares</TableHead>
                    <TableHead>Entrega</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {FIXTURE_ROWS.map((row) => (
                    <TableRow key={row.id} data-audit-row>
                      <TableCell>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-sm font-bold text-primary shrink-0">{row.order}</span>
                          <span className="text-[11px] text-muted-foreground uppercase truncate" title={row.created}>
                            {row.created}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-baseline gap-1.5 min-w-0 max-w-[240px]" title={`${row.client} · ${row.cnpj}`}>
                          <span className="font-semibold text-sm truncate">{row.client}</span>
                          <span className="text-[11px] text-muted-foreground truncate">{row.cnpj}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm truncate block max-w-[120px]">{row.city}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono font-bold text-sm text-primary">{row.total}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{row.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono font-semibold tabular-nums">
                        {row.pairs}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-destructive font-semibold">
                        {row.deadline}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
