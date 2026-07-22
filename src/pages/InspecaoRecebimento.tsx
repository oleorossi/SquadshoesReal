/**
 * Inspeção de Recebimento — paridade Tutor32 (compras #3).
 *
 * Para uma OC recebida, registra a inspeção de qualidade por item (aprovado /
 * rejeitado + motivo da não-conformidade). A quantidade rejeitada é enviada
 * automaticamente para a quarentena (RPC record_receipt_inspection).
 */
import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { ClipboardText, Info } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { receiptConversionFactor } from '@/lib/purchaseConversion';
import {
  useReceivedPOs, usePoItems, useInspectionHistory, useRecordInspection, type POItem,
} from '@/hooks/useReceiptInspection';

const num = (n: number) => (n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'dd/MM/yy HH:mm') : '—');

const STATUS_BADGE: Record<string, string> = {
  aprovado: 'bg-green-500/10 text-green-600 border-green-500/30',
  parcial: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  rejeitado: 'bg-red-500/10 text-red-600 border-red-500/30',
};

function ItemRow({ poId, item, inspector }: { poId: string; item: POItem; inspector: string }) {
  const [approved, setApproved] = useState('');
  const [rejected, setRejected] = useState('');
  const [reason, setReason] = useState('');
  const record = useRecordInspection();

  const a = parseFloat(approved.replace(',', '.')) || 0;
  const r = parseFloat(rejected.replace(',', '.')) || 0;

  function submit() {
    // F5-04: o inspetor digita na unidade da LINHA da OC (a mesma exibida em
    // "Qtd OC"), mas record_receipt_inspection → move_stock_status opera em
    // unidade de ESTOQUE (products.quantity/quarantine_qty). Converte pelo
    // MESMO fator do recebimento (ciente da unidade da linha) — sem regra
    // segura, bloqueia em vez de mover quantidade na unidade errada (ex.:
    // rejeitar 2 placas movia 2 dm² pra quarentena em vez de 300 dm²).
    const prod = item.products;
    const rc = receiptConversionFactor(item.unit, {
      name: prod?.name,
      unit: prod?.unit || 'un',
      purchase_unit: prod?.purchase_unit,
      conversion_rate: prod?.conversion_rate,
      dimensions_width: prod?.dimensions_width,
      dimensions_unit: prod?.dimensions_unit,
    });
    if (!rc.ok) { toast.error(rc.reason); return; }
    record.mutate(
      { poId, productId: item.product_id, approved: a * rc.factor, rejected: r * rc.factor, ncReason: reason, inspector },
      { onSuccess: () => { setApproved(''); setRejected(''); setReason(''); } },
    );
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{item.products?.name ?? '—'}{item.products?.sku && <span className="block text-[11px] text-muted-foreground font-mono">{item.products.sku}</span>}</TableCell>
      <TableCell className="text-right tabular-nums">{num(item.quantity)} {item.unit}</TableCell>
      <TableCell><Input value={approved} onChange={(e) => setApproved(e.target.value)} inputMode="decimal" placeholder="0" className="h-8 w-20" /></TableCell>
      <TableCell><Input value={rejected} onChange={(e) => setRejected(e.target.value)} inputMode="decimal" placeholder="0" className="h-8 w-20" /></TableCell>
      <TableCell><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo NC (se rejeitado)" className="h-8" /></TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="outline" className="h-8" onClick={submit} disabled={record.isPending || (a + r) <= 0}>Registrar</Button>
      </TableCell>
    </TableRow>
  );
}

export default function InspecaoRecebimento() {
  const { data: pos } = useReceivedPOs();
  const [poId, setPoId] = useState('');
  const [inspector, setInspector] = useState('');
  const { data: items } = usePoItems(poId || null);
  const { data: history } = useInspectionHistory();

  const selectedPo = useMemo(() => pos?.find((p) => p.id === poId), [pos, poId]);

  return (
    <div className="space-y-6 pb-12">
      <EditorialPageHeader
        sectionNumber="03"
        sectionLabel="COMPRAS · QUALIDADE"
        title="Inspeção de Recebimento"
        description="Inspeção de qualidade das OCs recebidas. Quantidade rejeitada (não-conformidade) vai automaticamente para a quarentena."
      />

      <div className="flex items-start gap-2 rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground">
        <Info className="size-4 mt-0.5 shrink-0" />
        <span>O que for <strong>rejeitado</strong> é movido do estoque disponível para a <strong>quarentena</strong> (veja em Estoque · Qualidade), onde pode ser liberado, bloqueado ou descartado.</span>
      </div>

      <Panel eyebrow="INSPECIONAR" title="Selecione a OC recebida">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Ordem de compra</Label>
            <Select value={poId} onValueChange={setPoId}>
              <SelectTrigger><SelectValue placeholder="OC recebida" /></SelectTrigger>
              <SelectContent>
                {pos?.map((p) => <SelectItem key={p.id} value={p.id}>{p.order_number} · {p.supplier_name ?? '—'}{p.received_date ? ` · ${fmtDate(p.received_date)}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Inspetor</Label>
            <Input value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="Nome do responsável" />
          </div>
        </div>
      </Panel>

      {poId && (
        <Panel eyebrow="ITENS" title={`Inspeção — ${selectedPo?.order_number ?? ''}`} flush>
          {!items?.length ? (
            <div className="p-6"><EmptyState icon={ClipboardText} title="Sem itens" description="Esta OC não tem itens." /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Qtd OC</TableHead>
                  <TableHead>Aprovado</TableHead>
                  <TableHead>Rejeitado</TableHead>
                  <TableHead>Motivo NC</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => <ItemRow key={it.id} poId={poId} item={it} inspector={inspector} />)}
              </TableBody>
            </Table>
          )}
        </Panel>
      )}

      {!!history?.length && (
        <Panel eyebrow="HISTÓRICO" title="Inspeções registradas" flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>OC</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Aprovado</TableHead>
                <TableHead className="text-right">Rejeitado</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Motivo NC</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="text-xs">{fmtDate(h.created_at)}</TableCell>
                  <TableCell className="font-mono text-xs">{h.purchase_orders?.order_number ?? '—'}</TableCell>
                  <TableCell className="text-sm">{h.products?.name ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(h.qty_approved)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(h.qty_rejected)}</TableCell>
                  <TableCell><Badge variant="outline" className={`text-xs ${STATUS_BADGE[h.status] ?? ''}`}>{h.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{h.nc_reason || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
