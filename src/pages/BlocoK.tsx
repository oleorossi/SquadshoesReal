/**
 * SPED Bloco K — Livro de Controle da Produção e do Estoque (paridade Tutor32).
 *
 * Gera os registros K100/K230/K235/K200 a partir dos dados internos (RPC
 * generate_bloco_k), exibe preview, permite baixar o TXT EFD e registra a geração
 * em sped_exports. Não transmite — a contabilidade valida no PVA da Receita.
 */
import { useMemo, useState } from 'react';
import { format, parseISO, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { EmptyState } from '@/components/ui/empty-state';
import { FileText, DownloadSimple as Download, Stack, CaretRight, FloppyDisk as Save, Factory, Package, Cube } from '@phosphor-icons/react';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import {
  useGenerateBlocoK, buildBlocoKTxt, useSpedExports, useRegisterSpedExport,
  type BlocoKResult, type BlocoKK230,
} from '@/hooks/useBlocoK';

const fmtQtd = (n: number) => (n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtDate = (d?: string) => (d ? format(parseISO(d), 'dd/MM/yyyy') : '—');

function monthOptions() {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = subMonths(now, i);
    out.push({ value: format(d, 'yyyy-MM'), label: format(d, 'MMMM yyyy', { locale: ptBR }) });
  }
  return out;
}

function K230Row({ k }: { k: BlocoKK230 }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow className="hover:bg-muted/30 transition-colors">
        <TableCell className="text-xs font-mono">{k.cod_doc_op}</TableCell>
        <TableCell className="font-medium">{k.cod_item}{k.descr && k.descr !== k.cod_item && <span className="block text-[11px] text-muted-foreground">{k.descr}</span>}</TableCell>
        <TableCell className="text-xs">{fmtDate(k.dt_ini)} → {fmtDate(k.dt_fin)}</TableCell>
        <TableCell className="text-right tabular-nums font-semibold">{fmtQtd(k.qtd)}</TableCell>
        <TableCell>
          {k.insumos.length > 0 ? (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                  <CaretRight className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`} /> {k.insumos.length} insumo(s)
                </Button>
              </CollapsibleTrigger>
            </Collapsible>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
      </TableRow>
      {open && k.insumos.map((i, idx) => (
        <TableRow key={idx} className="bg-muted/20">
          <TableCell />
          <TableCell colSpan={2} className="text-xs pl-6 text-muted-foreground">K235 · {i.cod_item} — {i.descr}</TableCell>
          <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{fmtQtd(i.qtd)}</TableCell>
          <TableCell className="text-xs text-muted-foreground">{fmtDate(i.dt_saida)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default function BlocoK() {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [result, setResult] = useState<BlocoKResult | null>(null);
  const generate = useGenerateBlocoK();
  const register = useRegisterSpedExport();
  const { data: history } = useSpedExports('EFD_ICMS_IPI_BLOCO_K');

  const period = useMemo(() => {
    const d = parseISO(`${month}-01`);
    return { start: format(startOfMonth(d), 'yyyy-MM-dd'), end: format(endOfMonth(d), 'yyyy-MM-dd') };
  }, [month]);

  const totals = useMemo(() => {
    if (!result) return null;
    const k235 = result.k230.reduce((s, k) => s + k.insumos.length, 0);
    const produced = result.k230.reduce((s, k) => s + (k.qtd || 0), 0);
    return { ops: result.k230.length, produced, k235, stock: result.k200.length };
  }, [result]);

  async function handleGenerate() {
    const r = await generate.mutateAsync(period);
    setResult(r);
  }

  function handleDownload() {
    if (!result) return;
    const { txt } = buildBlocoKTxt(result);
    const filename = `bloco-k-${month}.txt`;
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function handleRegister() {
    if (!result) return;
    const { records } = buildBlocoKTxt(result);
    register.mutate({
      sped_type: 'EFD_ICMS_IPI_BLOCO_K',
      period_start: period.start,
      period_end: period.end,
      filename: `bloco-k-${month}.txt`,
      total_records: records,
      notes: `${result.k230.length} OPs · ${result.k200.length} itens em estoque`,
    });
  }

  const monthLabel = monthOptions().find((m) => m.value === month)?.label ?? month;

  return (
    <div className="space-y-6 pb-12">
      <EditorialPageHeader
        sectionNumber="01"
        sectionLabel="FISCAL · SPED"
        title="Bloco K"
        description="Livro de Controle da Produção e do Estoque. Gera os registros K100/K230/K235/K200 a partir dos dados de produção e estoque para a contabilidade montar o EFD."
        actions={
          <div className="flex items-center gap-2">
            <Select value={month} onValueChange={(v) => { setMonth(v); setResult(null); }}>
              <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>{monthOptions().map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={handleGenerate} disabled={generate.isPending} className="gap-2">
              <Factory className="size-4" /> {generate.isPending ? 'Gerando…' : 'Gerar'}
            </Button>
          </div>
        }
      />

      {!result ? (
        <Panel>
          <EmptyState icon={FileText} title="Gere o Bloco K do período" description={`Selecione o mês e clique em Gerar. O período atual é ${monthLabel}.`} />
        </Panel>
      ) : (
        <>
          <StatGrid>
            <StatCard label="OPs produzidas (K230)" value={String(totals?.ops ?? 0)} icon={Factory} />
            <StatCard label="Pares produzidos" value={fmtQtd(totals?.produced ?? 0)} icon={Package} />
            <StatCard label="Insumos consumidos (K235)" value={String(totals?.k235 ?? 0)} icon={Cube} />
            <StatCard label="Itens em estoque (K200)" value={String(totals?.stock ?? 0)} icon={Stack} />
          </StatGrid>

          <div className="flex items-center gap-2">
            <Button onClick={handleDownload} className="gap-2"><Download className="size-4" /> Baixar .txt (EFD)</Button>
            <Button onClick={handleRegister} variant="outline" disabled={register.isPending} className="gap-2"><Save className="size-4" /> Registrar no histórico</Button>
            <Badge variant="secondary" className="ml-2">{monthLabel}</Badge>
          </div>

          {totals?.k235 === 0 && (totals?.ops ?? 0) > 0 && (
            <p className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              Atenção: nenhum insumo (K235) vinculado às OPs do período — confirme se os débitos de estoque por OP estão sendo registrados em <code>stock_movements</code>.
            </p>
          )}

          <Panel eyebrow="K230 · PRODUÇÃO" title="Itens produzidos" flush>
            {result.k230.length === 0 ? (
              <div className="p-6"><EmptyState icon={Factory} title="Sem produção no período" description="Nenhuma OP finalizada com data dentro do mês selecionado." /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="sticky top-0 z-sticky bg-muted/40 backdrop-blur-sm">
                    <TableHead>Doc. OP</TableHead>
                    <TableHead>Item produzido</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right tabular-nums">Qtd</TableHead>
                    <TableHead>Insumos (K235)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.k230.map((k) => <K230Row key={k.cod_doc_op} k={k} />)}
                </TableBody>
              </Table>
            )}
          </Panel>

          <Panel eyebrow="K200 · ESTOQUE" title={`Estoque escriturado em ${fmtDate(period.end)}`} flush>
            {result.k200.length === 0 ? (
              <div className="p-6"><EmptyState icon={Stack} title="Sem estoque" description="Nenhum produto com saldo no fim do período." /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="sticky top-0 z-sticky bg-muted/40 backdrop-blur-sm">
                    <TableHead>Cód. item</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right tabular-nums">Qtd</TableHead>
                    <TableHead>Ind. estoque</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.k200.map((s, i) => (
                    <TableRow key={i} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="text-xs font-mono">{s.cod_item}</TableCell>
                      <TableCell>{s.descr}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQtd(s.qtd)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">0 · próprio/informante</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </>
      )}

      {!!history?.length && (
        <Panel eyebrow="HISTÓRICO" title="Gerações registradas" flush>
          <Table>
            <TableHeader>
              <TableRow className="sticky top-0 z-sticky bg-muted/40 backdrop-blur-sm">
                <TableHead>Arquivo</TableHead>
                <TableHead>Período</TableHead>
                <TableHead className="text-right tabular-nums">Registros</TableHead>
                <TableHead>Gerado em</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="text-xs font-mono">{h.filename}</TableCell>
                  <TableCell className="text-xs">{fmtDate(h.period_start)} – {fmtDate(h.period_end)}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.total_records}</TableCell>
                  <TableCell className="text-xs">{h.generated_at ? format(parseISO(h.generated_at), 'dd/MM/yyyy HH:mm') : '—'}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs">{h.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
