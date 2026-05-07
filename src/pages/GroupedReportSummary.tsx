import AppLayout from "@/components/layout/AppLayout";
 import { Fragment, useMemo } from 'react';
 import { useQuery } from '@tanstack/react-query';
 import { supabase } from '@/integrations/supabase/client';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Layers, Printer, Package2, Grid3X3, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOrders } from '@/hooks/useOrders';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useOrderStraps } from '@/hooks/useOrderStraps';
 import { buildGroupedReportSummary } from '@/lib/groupedReportSummary';
import { SignedImage } from '@/components/ui/signed-image';

 const SECTOR_CONFIG = {
   corte: { label: 'Corte', emoji: '✂️', backPath: '/corte' },
   costura: { label: 'Costura', emoji: '🪡', backPath: '/costura' },
   aviamento: { label: 'Aviamento', emoji: '🧷', backPath: '/aviamento' },
   mesa: { label: 'Mesa', emoji: '🪑', backPath: '/mesa' },
   montagem: { label: 'Montagem', emoji: '🏗️', backPath: '/montagem' },
   solagem: { label: 'Solagem', emoji: '🦶', backPath: '/solagem' },
   acabamento: { label: 'Acabamento', emoji: '✨', backPath: '/acabamento' },
 } as const;

type SectorKey = keyof typeof SECTOR_CONFIG;

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="print:shadow-none print:border-border">
      <CardContent className="p-4 text-center">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-bold text-primary font-mono">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function GroupedReportSummary() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sectorKey = (searchParams.get('sector') || '').toLowerCase() as SectorKey;
  const sector = SECTOR_CONFIG[sectorKey];
  const idsParam = searchParams.get('ids') || '';
  const selectedIds = useMemo(() => idsParam.split(',').map((id) => id.trim()).filter(Boolean), [idsParam]);
  const selectedIdsSet = useMemo(() => new Set(selectedIds), [selectedIds]);

   const { data: orders = [], isLoading: ordersLoading, isError: ordersError } = useOrders();
   const { data: references = [], isLoading: referencesLoading, isError: referencesError } = useTechnicalSheets();
   const { getStrapsLabel } = useOrderStraps();
 
   const selectedOrders = useMemo(
     () => orders.filter((order) => selectedIdsSet.has(order.id)),
     [orders, selectedIdsSet],
   );
 
   // Additional data for Silk integration
   const { data: silkRegistrations = [] } = useQuery({
     queryKey: ['sole_silk_registrations'],
     queryFn: async () => {
       const { data, error } = await (supabase as any).from('sole_silk_registrations').select('*');
       if (error) throw error;
       return data;
     }
   });
 
   const { data: saleOrders = [] } = useQuery({
     queryKey: ['sale_orders'],
     queryFn: async () => {
       // economic_group_id mora em `clients`, não em `sale_orders`. Embed via FK.
       const { data, error } = await (supabase as any)
         .from('sale_orders')
         .select('id, client_id, client_name, order_number, clients(economic_group_id)');
       if (error) throw error;
       // Achata economic_group_id no row pra manter compatibilidade com consumers.
       return (data || []).map((r: any) => ({
         ...r,
         economic_group_id: r.clients?.economic_group_id ?? null,
       }));
     }
   });
 
   const referenceIds = useMemo(() => [...new Set(selectedOrders.map(o => o.reference_id).filter(Boolean))], [selectedOrders]);
   const { data: soleMappings = [] } = useQuery({
     queryKey: ['sole_ref_mappings', referenceIds],
     enabled: referenceIds.length > 0,
     queryFn: async () => {
        const { data, error } = await (supabase as any)
          .from('technical_sheet_sole_colors')
          .select('sheet_id, product_color, sole_product_id, products:sole_product_id(name)')
          .in('sheet_id', referenceIds);
       if (error) throw error;
       return data;
     },
   });
 
   const summary = useMemo(
     () => buildGroupedReportSummary(
       selectedOrders as any,
       references as any,
       getStrapsLabel as any,
       { silkRegistrations, saleOrders, soleMappings },
       sectorKey,
     ),
     [selectedOrders, references, getStrapsLabel, silkRegistrations, saleOrders, soleMappings, sectorKey],
   );


  const showBoxes = sectorKey === 'aviamento' || sectorKey === 'acabamento';
  const isLoading = ordersLoading || referencesLoading;
  const isError = ordersError || referencesError;

  const handlePrint = () => {
    // Clone current page content as static HTML for the print iframe
    const contentEl = document.querySelector('.print-a4-portrait') || document.querySelector('main');
    if (!contentEl) return;

    const clone = contentEl.cloneNode(true) as HTMLElement;
    // Remove screen-only toolbar (print:hidden elements)
    clone.querySelectorAll('.print\\:hidden, [class*="print:hidden"]').forEach(el => el.remove());

    // Gather all stylesheets
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map(el => el.outerHTML)
      .join('\n');

    const htmlContent = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Resumo Agrupado — ${sector.label}</title>
${styles}
<style>
  @page { size: A4 portrait; margin: 5mm 6mm; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 5mm 6mm; }
  @media print { body { padding: 0; } }
</style>
</head><body>${clone.outerHTML}</body></html>`;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, {
      position: 'fixed',
      width: '1px',
      height: '1px',
      right: '0',
      bottom: '0',
      opacity: '0',
      pointerEvents: 'none',
      border: '0',
    });

    const cleanup = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    iframe.onload = () => {
      const printWindow = iframe.contentWindow;
      if (!printWindow) { cleanup(); return; }
      try { printWindow.addEventListener('afterprint', cleanup, { once: true }); } catch {}
      setTimeout(() => {
        try { printWindow.focus(); printWindow.print(); } catch { cleanup(); }
      }, 300);
      setTimeout(cleanup, 60000);
    };

    iframe.srcdoc = htmlContent;
    document.body.appendChild(iframe);
  };

  if (!sector) {
    return (
      <AppLayout printMode>
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <Layers className="h-10 w-10 text-muted-foreground" />
              <div className="space-y-1">
                <h1 className="text-xl font-bold tracking-tight">Resumo agrupado inválido</h1>
                <p className="text-muted-foreground">O setor informado não é válido.</p>
              </div>
              <Button onClick={() => navigate('/dashboard')}>Voltar</Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (isLoading) {
    return (
      <AppLayout printMode>
        <div className="mx-auto max-w-6xl space-y-6">
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Carregando resumo agrupado...
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (isError) {
    return (
      <AppLayout printMode>
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <p className="font-semibold text-foreground">Falha ao carregar dados</p>
          <p className="text-sm text-muted-foreground">Verifique sua conexão e recarregue a página.</p>
        </div>
      </AppLayout>
    );
  }

  if (selectedOrders.length === 0) {
    return (
      <AppLayout printMode>
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <Layers className="h-10 w-10 text-muted-foreground" />
              <div className="space-y-1">
                <h1 className="text-xl font-bold tracking-tight">Nenhuma OP selecionada</h1>
                <p className="text-muted-foreground">Selecione as OPs no setor e clique em Agrupar novamente.</p>
              </div>
              <Button onClick={() => navigate(sector.backPath)}>Voltar para {sector.label}</Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout printMode>
      <div className="mx-auto max-w-7xl space-y-6 print:space-y-2 print-a4-portrait">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between print:hidden">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => navigate(sector.backPath)} aria-label={`Voltar para ${sector.label}`}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                {sector.emoji} Resumo Agrupado — {sector.label}
              </h1>
              <p className="text-sm text-muted-foreground">
                Visualize o agrupamento antes de imprimir.
              </p>
            </div>
          </div>

          <Button onClick={handlePrint} className="gap-2">
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
        </div>

        <div className="hidden print:block border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">
            {sector.emoji} Resumo Agrupado — {sector.label}
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerado em {new Date().toLocaleString('pt-BR')}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4 print:grid-cols-4 print-stats">
          <StatCard label="OPs" value={summary.grandTotalOps} />
          <StatCard label="Grupos" value={summary.items.length} />
          <StatCard label="Pares" value={summary.grandTotalPairs} />
           <StatCard label="Solados" value={new Set(summary.items.map(i => i.soleType)).size} />
        </div>

        {/* ── Solagem: compact per-solado grade table ── */}
        {sectorKey === 'solagem' && (
          <Card className="print:shadow-none print:border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">🦶 Grade Consolidada por Cor de Solado</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold">Cor do Solado</th>
                    <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold">OPs</th>
                    {summary.allActiveSizes.map(s => (
                      <th key={s} className="border-b border-border px-2 py-2 text-center font-mono text-xs">{s}</th>
                    ))}
                    <th className="border-b border-border px-3 py-2 text-center font-mono text-xs font-bold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.items.map(item => (
                    <tr key={item.groupKey} className="border-b border-border/40">
                      <td className="px-3 py-2 font-semibold">{item.soleType}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{item.opNumbers.join(', ')}</td>
                      {summary.allActiveSizes.map(s => (
                        <td key={s} className="px-2 py-2 text-center font-mono font-semibold">
                          {item.sizes[s] || ''}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center font-mono font-bold text-primary">{item.totalPairs}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td colSpan={2} className="px-3 py-2 font-bold text-right text-xs">TOTAL GERAL</td>
                    {summary.allActiveSizes.map(s => (
                      <td key={s} className="px-2 py-2 text-center font-mono font-bold">
                        {summary.grandSizeTotals[s] || ''}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center font-mono font-bold">{summary.grandTotalPairs}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* ── Acabamento: grouped by client/store ── */}
        {sectorKey === 'acabamento' && (() => {
          const referenceMap = new Map((references as any[]).map((r: any) => [r.id, r]));
          const soMap = new Map((saleOrders as any[]).map((so: any) => [so.id, so]));

          type StoreGroup = { clientName: string; pvNumber: string; clientOrders: typeof selectedOrders };
          const storeMap = new Map<string, StoreGroup>();
          for (const order of selectedOrders) {
            const so = soMap.get((order as any).sale_order_id);
            const clientName = (so as any)?.client_name || 'Sem Cliente';
            const pvNumber = (so as any)?.order_number || '';
            const key = (order as any).sale_order_id || `__no_client__${clientName}`;
            if (!storeMap.has(key)) storeMap.set(key, { clientName, pvNumber, clientOrders: [] });
            storeMap.get(key)!.clientOrders.push(order);
          }
          const storeGroups = Array.from(storeMap.values())
            .sort((a, b) => a.clientName.localeCompare(b.clientName, 'pt-BR'));

          return (
            <div className="space-y-4">
              {storeGroups.map(({ clientName, pvNumber, clientOrders }) => {
                const storeTotal = clientOrders.reduce((sum, o) => sum + (Number((o as any).quantity) || 0), 0);
                return (
                  <Card key={pvNumber || clientName} className="print:shadow-none print:border-border print-card overflow-hidden">
                    <CardHeader className="pb-3 bg-muted/30">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">🏪 {clientName}</CardTitle>
                        <Badge>{storeTotal} pares</Badge>
                      </div>
                      {pvNumber && <p className="text-xs text-muted-foreground mt-1">PV: {pvNumber}</p>}
                    </CardHeader>
                    <CardContent className="p-0">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="bg-muted/40">
                            <th className="border-b border-border px-3 py-2 text-left text-xs">OP</th>
                            <th className="border-b border-border px-3 py-2 text-left text-xs">Referência</th>
                            <th className="border-b border-border px-3 py-2 text-left text-xs">Cor</th>
                            {summary.allActiveSizes.map(s => (
                              <th key={s} className="border-b border-border px-2 py-2 text-center font-mono text-xs">{s}</th>
                            ))}
                            <th className="border-b border-border px-3 py-2 text-center font-mono text-xs font-bold">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clientOrders.map(order => {
                            const ref = referenceMap.get(order.reference_id) as any;
                            const grade = (order as any).grade as Record<string, number> | null;
                            const gradeSum = grade ? Object.values(grade).reduce((s, v) => s + Number(v || 0), 0) : 0;
                            const totalPairs = Number((order as any).quantity) || gradeSum || 0;
                            const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 1;
                            return (
                              <tr key={order.id} className="border-b border-border/40">
                                <td className="px-3 py-2 font-mono text-xs font-semibold">{order.order_number}</td>
                                <td className="px-3 py-2 text-xs">{ref ? `${ref.code || ''} ${ref.name || ''}`.trim() : '—'}</td>
                                <td className="px-3 py-2 text-xs">{(order as any).color || '—'}</td>
                                {summary.allActiveSizes.map(s => {
                                  const qty = grade ? Math.round((Number(grade[s]) || 0) * multiplier) : 0;
                                  return <td key={s} className="px-2 py-2 text-center font-mono text-xs">{qty || ''}</td>;
                                })}
                                <td className="px-3 py-2 text-center font-mono font-bold text-xs">{totalPairs}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          );
        })()}

        {/* Group by sole type first, then category (all sectors except solagem/acabamento) */}
        {sectorKey !== 'solagem' && sectorKey !== 'acabamento' && (() => {
          const soleGroups = new Map<string, typeof summary.categories>();
          for (const cat of summary.categories) {
            for (const item of cat.items) {
              const sole = item.soleType;
              if (!soleGroups.has(sole)) soleGroups.set(sole, []);
              const existing = soleGroups.get(sole)!;
              let catGroup = existing.find(c => c.category === cat.category);
              if (!catGroup) {
                catGroup = { category: cat.category, items: [], totalPairs: 0, sizeTotals: {} };
                existing.push(catGroup);
              }
              catGroup.items.push(item);
              catGroup.totalPairs += item.totalPairs;
              summary.allActiveSizes.forEach(s => {
                catGroup!.sizeTotals[s] = (catGroup!.sizeTotals[s] || 0) + (item.sizes[s] || 0);
              });
            }
          }
          return Array.from(soleGroups.entries()).map(([soleType, cats]) => {
            const soleTotal = cats.reduce((s, c) => s + c.totalPairs, 0);
            return (
              <section key={soleType} className="space-y-4">
                <div className="flex flex-col gap-2 border-b-2 pb-3 md:flex-row md:items-end md:justify-between" style={{ borderColor: soleType === 'Solado Preto' ? '#333' : '#c9a84c' }}>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">{soleType === 'Solado Preto' ? '⬛' : '🟨'} {soleType}</h2>
                    <p className="text-sm text-muted-foreground">
                      {cats.reduce((s, c) => s + c.items.length, 0)} grupo(s) • {soleTotal} pares
                    </p>
                  </div>
                  <Badge variant="secondary" className="w-fit">{soleTotal} pares</Badge>
                </div>

                {cats.map((categoryGroup) => (
                  <div key={categoryGroup.category} className="space-y-4">
                    <h3 className="text-lg font-semibold border-b border-border pb-2">{categoryGroup.category} — {categoryGroup.totalPairs} pares</h3>

            <div className="grid gap-4">
              {categoryGroup.items.map((item) => {
                const activeSizes = summary.allActiveSizes.filter((size) => (item.sizes[size] || 0) > 0);
                const boxCount = Math.ceil(item.totalPairs / 12);

                return (
                  <Card key={item.groupKey} className="overflow-hidden print:shadow-none print:border-border print-card">
                    <CardContent className="p-4">
                      <div className="grid gap-4 md:grid-cols-[180px,1fr] print:grid-cols-[120px,1fr] print:gap-2">
                        <div className="overflow-hidden rounded-lg border border-border bg-muted/40 aspect-square flex items-center justify-center print-img">
                          {item.imageUrl ? (
                            <SignedImage
                              src={item.imageUrl}
                              alt={`${item.refCode} ${item.refName} ${item.color}`}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <span className="text-sm text-muted-foreground">Sem foto</span>
                          )}
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-xl font-bold">
                                {item.refCode} — {item.refName}
                              </h3>
                               <Badge variant="outline">{item.color}</Badge>
                               <Badge>{item.totalPairs} pares</Badge>
                               {item.silk && (
                                 <Badge variant="secondary" className="gap-2 px-2 py-1 h-auto bg-stone-100 text-stone-800 border-stone-200">
                                   {item.silk.silk_url && (
                                     <div className="h-5 w-5 rounded-sm overflow-hidden border bg-card">
                                       <SignedImage src={item.silk.silk_url} className="h-full w-full object-contain" />
                                     </div>
                                   )}
                                   <span className="text-[10px] font-bold uppercase tracking-wider">Silk: {item.silk.silk_name}</span>
                                 </Badge>
                               )}
                             </div>

                            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                              <span>OPs: {item.opNumbers.join(', ')}</span>
                              {item.strapsLabel ? (
                                <Badge variant="secondary">Tiras: {item.strapsLabel}</Badge>
                              ) : null}
                            </div>
                          </div>

                          <div className="overflow-x-auto rounded-lg border border-border print-table">
                            <table className="w-full min-w-max border-collapse text-sm">
                              <thead>
                                <tr className="bg-muted/60">
                                  <th className="border-b border-border px-3 py-2 text-left text-xs">OP</th>
                                  {activeSizes.map((size) => (
                                    <th key={size} className="border-b border-border px-3 py-2 text-center font-mono text-xs">
                                      {size}
                                    </th>
                                  ))}
                                  <th className="border-b border-border px-3 py-2 text-center font-mono text-xs">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {item.individualGrades.map((ig) => (
                                  <Fragment key={ig.opNumber}>
                                    <tr>
                                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                                        <div className="font-medium text-foreground">{ig.opNumber}</div>
                                        {sectorKey === 'aviamento' && ig.fichaCount > 0 ? (
                                          <div className="text-[11px] text-muted-foreground">
                                            {Number.isInteger(ig.fichaCount)
                                              ? `${ig.fichaCount} ficha${ig.fichaCount === 1 ? '' : 's'}`
                                              : `${ig.fichaCount.toFixed(2).replace('.', ',')} fichas`}
                                          </div>
                                        ) : null}
                                      </td>
                                      {activeSizes.map((size) => (
                                        <td key={size} className="px-3 py-2 text-center font-mono">
                                          {ig.sizes[size] || ''}
                                        </td>
                                      ))}
                                      <td className="px-3 py-2 text-center font-mono font-semibold">{ig.totalPairs}</td>
                                    </tr>
                                    {sectorKey === 'aviamento' && ig.pairsPerFicha > 0 ? (
                                      <tr className="bg-muted/30">
                                        <td className="px-3 py-2 pl-5 text-xs font-medium text-muted-foreground whitespace-nowrap">↳ Por ficha</td>
                                        {activeSizes.map((size) => (
                                          <td key={size} className="px-3 py-2 text-center font-mono font-medium">
                                            {ig.perFichaSizes[size] || ''}
                                          </td>
                                        ))}
                                        <td className="px-3 py-2 text-center font-mono font-semibold">{ig.pairsPerFicha}</td>
                                      </tr>
                                    ) : null}
                                  </Fragment>
                                ))}
                                {item.totalPairs > 0 && (
                                  <tr className="border-t border-border bg-muted/40">
                                    <td className="px-3 py-2 text-xs font-bold">TOTAL</td>
                                    {activeSizes.map((size) => (
                                      <td key={size} className="px-3 py-2 text-center font-mono font-bold">
                                        {item.sizes[size] || ''}
                                      </td>
                                    ))}
                                    <td className="px-3 py-2 text-center font-mono font-bold">{item.totalPairs}</td>
                                  </tr>
                                )}
                                {item.baseGradeSum > 0 && (
                                  <tr className="border-t border-border bg-primary/5">
                                    <td className="px-3 py-2 text-xs font-bold text-primary">1 FICHA</td>
                                    {activeSizes.map((size) => (
                                      <td key={size} className="px-3 py-2 text-center font-mono font-semibold text-primary">
                                        {item.baseGrade[size] || ''}
                                      </td>
                                    ))}
                                    <td className="px-3 py-2 text-center font-mono font-bold text-primary">{item.baseGradeSum}</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>

                          {showBoxes ? (
                            <div className="space-y-2">
                              <p className="text-sm font-semibold">Caixas ({boxCount} × 12 pares)</p>
                              <div className="flex flex-wrap gap-2">
                                {Array.from({ length: boxCount }, (_, index) => (
                                  <div
                                    key={index}
                                    className="flex h-10 w-10 items-center justify-center rounded-md border-2 border-foreground font-mono text-sm font-bold print-box"
                                  >
                                    {index + 1}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className="print:shadow-none print:border-border print-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Subtotal {soleType} / {categoryGroup.category}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-max border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted/60">
                      {summary.allActiveSizes.map((size) => (
                        <th key={size} className="border-b border-border px-3 py-2 text-center font-mono text-xs">
                          {size}
                        </th>
                      ))}
                      <th className="border-b border-border px-3 py-2 text-center font-mono text-xs">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {summary.allActiveSizes.map((size) => (
                        <td key={size} className="px-3 py-2 text-center font-mono">
                          {categoryGroup.sizeTotals[size] || ''}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center font-mono font-bold">{categoryGroup.totalPairs}</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
                  </div>
                ))}
              </section>
            );
          });
        })()}

        <Card className="print:shadow-none print:border-border print-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Grid3X3 className="h-5 w-5" />
              Resumo Geral Agrupado
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                 <tr className="bg-muted/60">
                   <th className="border-b border-border px-3 py-2 text-left text-xs">Solado</th>
                   <th className="border-b border-border px-3 py-2 text-left text-xs">Referência</th>
                   <th className="border-b border-border px-3 py-2 text-left text-xs">Cor</th>
                   <th className="border-b border-border px-3 py-2 text-left text-xs">OPs</th>
                   {summary.allActiveSizes.map((size) => (
                     <th key={size} className="border-b border-border px-3 py-2 text-center font-mono text-xs">{size}</th>
                   ))}
                   <th className="border-b border-border px-3 py-2 text-center font-mono text-xs">Total</th>
                 </tr>
               </thead>
               <tbody>
                 {summary.items.map((item) => (
                   <tr key={`summary-${item.soleType}-${item.refId}-${item.color}`}>
                     <td className="px-3 py-2">{item.soleType}</td>
                     <td className="px-3 py-2 font-medium">{item.refCode} {item.refName}</td>
                     <td className="px-3 py-2">{item.color}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{item.opNumbers.join(', ')}</td>
                    {summary.allActiveSizes.map((size) => (
                      <td key={size} className="px-3 py-2 text-center font-mono">
                        {item.sizes[size] || ''}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center font-mono font-bold">{item.totalPairs}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-muted/40">
                  <td colSpan={4} className="px-3 py-2 text-right font-bold">TOTAL GERAL</td>
                  {summary.allActiveSizes.map((size) => (
                    <td key={size} className="px-3 py-2 text-center font-mono font-bold">
                      {summary.grandSizeTotals[size] || ''}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center font-mono font-bold">{summary.grandTotalPairs}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 print:hidden">
          <div className="flex items-center gap-3">
            <Package2 className="h-5 w-5 text-primary" />
            <p className="text-sm text-muted-foreground">
              Revise o resumo e use o botão de imprimir apenas quando estiver tudo certo.
            </p>
          </div>
          <Button onClick={handlePrint} className="gap-2">
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
