/**
 * Qualidade de Estoque — paridade Tutor32 (estoque #1).
 *
 * Aba 1 (Quarentena & Bloqueio): operacionaliza os baldes disponível/quarentena/
 * bloqueado (antes colunas mortas) via RPC move_stock_status — enviar, mover entre,
 * liberar e descartar, com histórico de auditoria.
 * Aba 2 (Recall de Lote): ativa a RPC recall_lot_buyers (antes morta no front) —
 * dado um lote, lista quem comprou (cliente/NF/pares).
 */
import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { ShieldWarning, ArrowRight, Trash, LockSimple, CheckCircle, Recycle, Package } from '@phosphor-icons/react';
import {
  useHeldStock, useProductSearch, useQuarantineHistory, useMoveStockStatus,
  useLotsForRecall, useRecallLot, type StockBucket, type ProductSearchRow, type RecallBuyer,
} from '@/hooks/useStockQuality';

const num = (n: number) => (n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtDate = (d?: string) => (d ? format(parseISO(d), 'dd/MM/yyyy') : '—');

const BUCKET_LABEL: Record<string, string> = { disponivel: 'Disponível', quarentena: 'Quarentena', bloqueado: 'Bloqueado', descarte: 'Descarte' };
const STATUS_BADGE: Record<string, string> = {
  quarantine: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  blocked: 'bg-red-500/10 text-red-600 border-red-500/30',
  released: 'bg-green-500/10 text-green-600 border-green-500/30',
  scrapped: 'bg-muted text-muted-foreground border-border',
};

function MoveForm() {
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<ProductSearchRow | null>(null);
  const [qty, setQty] = useState('');
  const [from, setFrom] = useState<StockBucket>('disponivel');
  const [to, setTo] = useState<StockBucket>('quarentena');
  const [reason, setReason] = useState('');
  const { data: results } = useProductSearch(term);
  const move = useMoveStockStatus();

  const srcBalance = selected ? (from === 'disponivel' ? selected.quantity : from === 'quarentena' ? selected.quarantine_qty : selected.blocked_qty) : 0;

  function submit() {
    if (!selected) return;
    const q = parseFloat(qty.replace(',', '.'));
    move.mutate({ productId: selected.id, qty: q, from, to, reason }, {
      onSuccess: () => { setQty(''); setReason(''); setSelected(null); setTerm(''); },
    });
  }

  return (
    <Panel eyebrow="MOVER ESTOQUE" title="Enviar / mover / liberar / descartar" subtitle="Disponível ↔ Quarentena ↔ Bloqueado · Descarte (baixa definitiva)">
      <div className="space-y-3">
        {!selected ? (
          <div className="space-y-2">
            <Label>Produto</Label>
            <SearchInput
              value={term}
              onChange={setTerm}
              placeholder="Buscar por nome ou SKU (≥2 letras)"
              debounceMs={300}
            />
            {results && results.length === 0 && term.trim().length >= 2 && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                Nenhum resultado para "{term}"
                <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => setTerm('')}>
                  Limpar busca
                </Button>
              </p>
            )}
            {results && results.length > 0 && (
              <div className="rounded-md border border-border divide-y divide-border max-h-56 overflow-y-auto">
                {results.map((p) => (
                  <button key={p.id} onClick={() => { setSelected(p); }} className="w-full text-left px-3 py-2 hover:bg-muted/40 text-sm flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{p.name}{p.sku && <span className="text-muted-foreground font-mono text-xs"> · {p.sku}</span>}</span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">disp {num(p.quantity)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted/30 p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium truncate">{selected.name}</p>
              <p className="text-xs text-muted-foreground tabular-nums">disp {num(selected.quantity)} · quar {num(selected.quarantine_qty)} · bloq {num(selected.blocked_qty)}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Trocar</Button>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label>De</Label>
            <Select value={from} onValueChange={(v) => setFrom(v as StockBucket)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="disponivel">Disponível</SelectItem>
                <SelectItem value="quarentena">Quarentena</SelectItem>
                <SelectItem value="bloqueado">Bloqueado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Para</Label>
            <Select value={to} onValueChange={(v) => setTo(v as StockBucket)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="disponivel">Disponível</SelectItem>
                <SelectItem value="quarentena">Quarentena</SelectItem>
                <SelectItem value="bloqueado">Bloqueado</SelectItem>
                <SelectItem value="descarte">Descarte (baixa)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Quantidade {selected && <span className="text-muted-foreground font-normal">(saldo {num(srcBalance)})</span>}</Label>
            <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Defeito, avaria…" />
          </div>
        </div>

        <Button onClick={submit} disabled={!selected || !qty || from === to || move.isPending} className="gap-2">
          <ArrowRight className="size-4" /> {move.isPending ? 'Movendo…' : `Mover ${BUCKET_LABEL[from]} → ${BUCKET_LABEL[to]}`}
        </Button>
      </div>
    </Panel>
  );
}

function HeldTable() {
  const { data: held, isLoading } = useHeldStock();
  const move = useMoveStockStatus();

  if (isLoading) return <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (!held?.length) return <div className="p-6"><EmptyState icon={CheckCircle} title="Nada retido" description="Nenhum produto em quarentena ou bloqueado." /></div>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Produto</TableHead>
          <TableHead className="text-right">Disponível</TableHead>
          <TableHead className="text-right">Quarentena</TableHead>
          <TableHead className="text-right">Bloqueado</TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {held.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="font-medium">{p.name}{p.sku && <span className="block text-[11px] text-muted-foreground font-mono">{p.sku}</span>}</TableCell>
            <TableCell className="text-right tabular-nums">{num(p.quantity)}</TableCell>
            <TableCell className="text-right tabular-nums">{p.quarantine_qty > 0 ? <Badge variant="outline" className={STATUS_BADGE.quarantine}>{num(p.quarantine_qty)}</Badge> : '—'}</TableCell>
            <TableCell className="text-right tabular-nums">{p.blocked_qty > 0 ? <Badge variant="outline" className={STATUS_BADGE.blocked}>{num(p.blocked_qty)}</Badge> : '—'}</TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1 flex-wrap">
                {p.quarantine_qty > 0 && (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => move.mutate({ productId: p.id, qty: p.quarantine_qty, from: 'quarentena', to: 'disponivel', reason: 'Liberado da quarentena' })}><CheckCircle className="size-3.5" /> Liberar</Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => move.mutate({ productId: p.id, qty: p.quarantine_qty, from: 'quarentena', to: 'bloqueado', reason: 'Bloqueado da quarentena' })}><LockSimple className="size-3.5" /> Bloquear</Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-destructive" onClick={() => move.mutate({ productId: p.id, qty: p.quarantine_qty, from: 'quarentena', to: 'descarte', reason: 'Descarte da quarentena' })}><Trash className="size-3.5" /> Descartar</Button>
                  </>
                )}
                {p.blocked_qty > 0 && (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => move.mutate({ productId: p.id, qty: p.blocked_qty, from: 'bloqueado', to: 'disponivel', reason: 'Desbloqueado' })}><CheckCircle className="size-3.5" /> Desbloquear</Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-destructive" onClick={() => move.mutate({ productId: p.id, qty: p.blocked_qty, from: 'bloqueado', to: 'descarte', reason: 'Descarte do bloqueio' })}><Trash className="size-3.5" /> Descartar</Button>
                  </>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function HistoryTable() {
  const { data: hist } = useQuarantineHistory();
  if (!hist?.length) return null;
  return (
    <Panel eyebrow="HISTÓRICO" title="Movimentações de qualidade" flush>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Produto</TableHead>
            <TableHead className="text-right">Qtd</TableHead>
            <TableHead>Movimento</TableHead>
            <TableHead>Motivo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {hist.map((h) => (
            <TableRow key={h.id}>
              <TableCell className="text-xs">{h.created_at ? format(parseISO(h.created_at), 'dd/MM/yy HH:mm') : '—'}</TableCell>
              <TableCell className="text-sm">{h.products?.name ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{num(h.quantity)}</TableCell>
              <TableCell><Badge variant="outline" className={`text-xs ${STATUS_BADGE[h.status] ?? ''}`}>{h.resolution_notes || h.status}</Badge></TableCell>
              <TableCell className="text-xs text-muted-foreground">{h.reason}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

function RecallTab() {
  const { data: lots } = useLotsForRecall();
  const [lotId, setLotId] = useState('');
  const recall = useRecallLot();
  const [buyers, setBuyers] = useState<RecallBuyer[] | null>(null);

  function run() {
    if (!lotId) return;
    recall.mutate(lotId, { onSuccess: (rows) => setBuyers(rows) });
  }

  return (
    <div className="space-y-4">
      <Panel eyebrow="RECALL" title="Localizar compradores de um lote" subtitle="Para recall/rastreabilidade: quem recebeu pares de um lote específico">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1.5 flex-1 min-w-[260px]">
            <Label>Lote</Label>
            <Select value={lotId} onValueChange={(v) => { setLotId(v); setBuyers(null); }}>
              <SelectTrigger><SelectValue placeholder="Selecione o lote" /></SelectTrigger>
              <SelectContent>
                {lots?.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.lot_number} · {l.products?.name ?? '—'} ({l.status})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={run} disabled={!lotId || recall.isPending} className="gap-2"><Recycle className="size-4" /> {recall.isPending ? 'Buscando…' : 'Localizar compradores'}</Button>
        </div>
      </Panel>

      {buyers && (
        <Panel eyebrow="RESULTADO" title={`${buyers.length} entrega(s) encontrada(s)`} flush>
          {buyers.length === 0 ? (
            <div className="p-6"><EmptyState icon={Package} title="Nenhum comprador" description="Este lote não consta em entregas faturadas — ainda em estoque ou não vendido." /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PV</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead className="text-right">Pares</TableHead>
                  <TableHead>NF-e</TableHead>
                  <TableHead>Entrega</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buyers.map((b, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{b.sale_order_number}</TableCell>
                    <TableCell className="text-sm">{b.client_name}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{b.client_cnpj}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(b.pairs_received)}</TableCell>
                    <TableCell className="text-xs">{b.nfe_number || '—'}</TableCell>
                    <TableCell className="text-xs">{fmtDate(b.delivery_date)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      )}
    </div>
  );
}

export default function EstoqueQualidade() {
  return (
    <div className="space-y-6 pb-12">
      <EditorialPageHeader
        sectionNumber="01"
        sectionLabel="ESTOQUE · QUALIDADE"
        title="Qualidade de Estoque"
        description="Quarentena, bloqueio e descarte de estoque, e recall de lote (rastreabilidade de quem comprou)."
      />
      <Tabs defaultValue="quarentena">
        <TabsList>
          <TabsTrigger value="quarentena" className="gap-1.5"><ShieldWarning className="size-4" /> Quarentena & Bloqueio</TabsTrigger>
          <TabsTrigger value="recall" className="gap-1.5"><Recycle className="size-4" /> Recall de Lote</TabsTrigger>
        </TabsList>
        <TabsContent value="quarentena" className="space-y-4 mt-4">
          <MoveForm />
          <Panel eyebrow="RETIDO" title="Em quarentena / bloqueado" flush><HeldTable /></Panel>
          <HistoryTable />
        </TabsContent>
        <TabsContent value="recall" className="mt-4">
          <RecallTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
