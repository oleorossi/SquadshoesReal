/**
 * Apuração mensal de impostos (estimativa) — paridade Tutor32 (fiscal #3).
 *
 * Consolida o faturamento das NF-e autorizadas no mês e ESTIMA os débitos de
 * ICMS/IPI/PIS/COFINS via os perfis tributários por NCM (fiscal #2). Deixa
 * explícito o que ainda não é apurável (itens sem perfil). Os valores reais
 * vêm do XML emitido pelo provider — isto é apoio gerencial, não a apuração oficial.
 */
import { useMemo, useState } from 'react';
import { format, parseISO, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Calculator, Receipt, Warning, Info } from '@phosphor-icons/react';
import { formatCurrency } from '@/lib/utils';
import { useEstimateTaxApuration, type TaxApuration } from '@/hooks/useTaxApuration';

function monthOptions() {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = subMonths(now, i);
    out.push({ value: format(d, 'yyyy-MM'), label: format(d, 'MMMM yyyy', { locale: ptBR }) });
  }
  return out;
}

export default function ApuracaoImpostos() {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [result, setResult] = useState<TaxApuration | null>(null);
  const estimate = useEstimateTaxApuration();

  const period = useMemo(() => {
    const d = parseISO(`${month}-01`);
    return { start: format(startOfMonth(d), 'yyyy-MM-dd'), end: format(endOfMonth(d), 'yyyy-MM-dd') };
  }, [month]);

  async function handleRun() {
    const r = await estimate.mutateAsync(period);
    setResult(r);
  }

  const a = result?.apuracao;
  const totalImpostos = a ? a.icms + a.ipi + a.pis + a.cofins : 0;
  const monthLabel = monthOptions().find((m) => m.value === month)?.label ?? month;

  return (
    <div className="space-y-6 pb-12">
      <EditorialPageHeader
        sectionNumber="03"
        sectionLabel="FISCAL · APURAÇÃO"
        title="Apuração de impostos"
        description="Faturamento das NF-e autorizadas no mês e estimativa dos débitos de ICMS/IPI/PIS/COFINS pelos perfis tributários por NCM."
        actions={
          <div className="flex items-center gap-2">
            <Select value={month} onValueChange={(v) => { setMonth(v); setResult(null); }}>
              <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>{monthOptions().map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={handleRun} disabled={estimate.isPending} className="gap-2">
              <Calculator className="size-4" /> {estimate.isPending ? 'Apurando…' : 'Apurar'}
            </Button>
          </div>
        }
      />

      <div className="flex items-start gap-2 rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground">
        <Info className="size-4 mt-0.5 shrink-0" />
        <span>Estimativa de apoio gerencial baseada nos <strong>perfis tributários por NCM</strong>. Os valores oficiais de imposto são os do XML emitido pelo provider. Itens sem perfil aparecem como "base sem perfil" — configure-os em <strong>Perfis Tributários</strong>. Obs.: o <strong>faturamento bruto</strong> é o total das NF-e (com impostos/frete/desconto); a <strong>base</strong> é o valor de mercadoria (preço × qtd, pré-imposto) — por isso os dois divergem.</span>
      </div>

      {!result ? (
        <Panel><EmptyState icon={Receipt} title="Apure o período" description={`Selecione o mês e clique em Apurar. Período atual: ${monthLabel}.`} /></Panel>
      ) : (
        <>
          <StatGrid>
            {[
              { label: 'NF-e autorizadas', value: String(result.notes_count), icon: Receipt, tone: 'default' as const },
              { label: 'Faturamento bruto', value: formatCurrency(result.faturamento_bruto), icon: Calculator, tone: 'primary' as const },
              { label: 'Canceladas (não conta)', value: formatCurrency(result.faturamento_cancelado), icon: Warning, tone: 'destructive' as const },
              { label: 'Base apurável', value: formatCurrency(a?.base_apuravel ?? 0), icon: Receipt, tone: 'default' as const },
            ].map((k) => (
              <StatCard key={k.label} label={k.label} value={k.value} icon={k.icon} tone={k.tone} />
            ))}
          </StatGrid>

          {(a?.base_sem_perfil ?? 0) > 0 && (
            <p className="flex items-center gap-2 text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <Warning className="size-4 shrink-0" />
              {formatCurrency(a!.base_sem_perfil)} em itens sem perfil tributário — não estão sendo apurados. Cadastre os NCMs faltantes em Perfis Tributários.
            </p>
          )}

          {((result as any).base_sem_itens ?? 0) > 0 && (
            <p className="flex items-center gap-2 text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <Warning className="size-4 shrink-0" />
              {formatCurrency((result as any).base_sem_itens)} em {String((result as any).notes_sem_itens ?? 0)} NF-e autorizada(s) <strong>sem vínculo a pedido</strong> (sincronizadas do GestaoClick) — entram no faturamento bruto mas <strong>não</strong> na base por NCM. Vincule ao PV ou emita pelo sistema para apurar por NCM.
            </p>
          )}

          <Panel eyebrow="DÉBITOS ESTIMADOS" title="Impostos do período">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'ICMS', value: a?.icms ?? 0 },
                { label: 'IPI', value: a?.ipi ?? 0 },
                { label: 'PIS', value: a?.pis ?? 0 },
                { label: 'COFINS', value: a?.cofins ?? 0 },
                { label: 'Total', value: totalImpostos, strong: true },
              ].map((t) => (
                <div key={t.label} className={`rounded-lg border p-3 ${t.strong ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/30'}`}>
                  <p className="text-xs text-muted-foreground">{t.label}</p>
                  <p className={`text-base font-bold tabular-nums ${t.strong ? 'text-primary' : 'text-foreground'}`}>{formatCurrency(t.value)}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="POR NCM" title="Detalhamento" flush>
            {!a?.by_ncm?.length ? (
              <div className="p-6"><EmptyState icon={Receipt} title="Sem itens no período" description="Nenhum item de NF-e autorizada encontrado." /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>NCM</TableHead>
                      <TableHead className="text-right">Base</TableHead>
                      <TableHead className="text-right">ICMS</TableHead>
                      <TableHead className="text-right">IPI</TableHead>
                      <TableHead className="text-right">PIS</TableHead>
                      <TableHead className="text-right">COFINS</TableHead>
                      <TableHead>Perfil</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {a.by_ncm.map((row, i) => (
                      <TableRow key={i} className={!row.has_profile ? 'bg-amber-500/5' : ''}>
                        <TableCell className="font-mono text-xs">{row.ncm}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(row.base)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(row.icms)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(row.ipi)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(row.pis)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(row.cofins)}</TableCell>
                        <TableCell>
                          {row.has_profile
                            ? <Badge variant="secondary" className="text-xs">com perfil</Badge>
                            : <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/40">sem perfil</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
