import { useEffect, useState } from 'react';
import { CircleNotch as Loader2, Warning } from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useDeleteSheet,
  useTechnicalSheetDeleteImpact,
  type TechnicalSheetDeleteLinks,
} from '@/hooks/useTechnicalSheets';

interface SheetTarget {
  id: string;
  name: string;
  code?: string | null;
}

interface Props {
  open: boolean;
  sheet: SheetTarget | null;
  onOpenChange: (open: boolean) => void;
}

const formatNumber = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const PRESERVED_LINK_LABELS: Array<{
  key: keyof TechnicalSheetDeleteLinks;
  singular: string;
  plural: string;
}> = [
  { key: 'sale_order_items', singular: 'item de Pedido de Venda', plural: 'itens de Pedido de Venda' },
  { key: 'technical_sheet_snapshots', singular: 'snapshot técnico', plural: 'snapshots técnicos' },
  { key: 'technical_strap_line_identity_map', singular: 'identidade de tira', plural: 'identidades de tira' },
  { key: 'production_wave_items', singular: 'item de onda histórica', plural: 'itens de onda histórica' },
  { key: 'ready_stock', singular: 'saldo de pronta-entrega', plural: 'saldos de pronta-entrega' },
  { key: 'ready_stock_movements', singular: 'movimento de pronta-entrega', plural: 'movimentos de pronta-entrega' },
  { key: 'nfe_devolucao_item_claims', singular: 'vínculo fiscal de devolução', plural: 'vínculos fiscais de devolução' },
];

export function TechnicalSheetRetirementDialog({ open, sheet, onOpenChange }: Props) {
  const sheetId = sheet?.id ?? null;
  const impact = useTechnicalSheetDeleteImpact(open ? sheetId : null);
  const deleteSheet = useDeleteSheet();
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [requestId, setRequestId] = useState('');
  const [persistentError, setPersistentError] = useState('');

  useEffect(() => {
    if (!open || !sheetId) return;
    setReason('');
    setConfirmation('');
    setPersistentError('');
    setRequestId(crypto.randomUUID());
  }, [open, sheetId]);

  const data = impact.data;
  const typedCorrectly = !!sheet && confirmation.trim() === sheet.name;
  const reasonValid = reason.trim().length >= 10;
  const canConfirm = !!data
    && data.can_retire
    && !!requestId
    && typedCorrectly
    && reasonValid
    && !deleteSheet.isPending;

  const preservedLinks = data
    ? PRESERVED_LINK_LABELS
      .map(item => ({ ...item, count: Number(data.links[item.key] || 0) }))
      .filter(item => item.count > 0)
    : [];
  const blockingReasons = data
    ? [
      data.blocking_active_order_count > 0
        ? `${formatNumber.format(data.blocking_active_order_count)} OP(s) com fato fabril ou PV terminal`
        : null,
      data.blocking_wave_count > 0
        ? `${formatNumber.format(data.blocking_wave_count)} onda(s) já iniciada(s)`
        : null,
      Number(data.blocking_strap_demand_count || 0) > 0
        ? `${formatNumber.format(Number(data.blocking_strap_demand_count))} demanda(s) de tira com fato realizado`
        : null,
      Number(data.blocking_service_order_count || 0) > 0
        ? `${formatNumber.format(Number(data.blocking_service_order_count))} OS(s) terceirizada(s) com fato físico, financeiro ou vínculo ambíguo`
        : null,
    ].filter((reason): reason is string => !!reason)
    : [];

  const handleOpenChange = (nextOpen: boolean) => {
    if (deleteSheet.isPending) return;
    onOpenChange(nextOpen);
  };

  const handleConfirm = async () => {
    if (!sheet || !data || !canConfirm) return;
    setPersistentError('');
    try {
      await deleteSheet.mutateAsync({
        id: sheet.id,
        expectedUpdatedAt: data.updated_at,
        clientRequestId: requestId,
        reason: reason.trim(),
      });
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'A exclusão foi recusada pelo servidor.';
      await impact.refetch();
      setPersistentError(`${message} O impacto foi atualizado; confira novamente antes de tentar.`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Warning className="h-5 w-5 text-destructive" weight="fill" />
            Excluir ficha {sheet?.name || ''}?
          </DialogTitle>
          <DialogDescription>
            A análise abaixo vem do banco e será conferida novamente no momento da confirmação.
          </DialogDescription>
        </DialogHeader>

        {impact.isLoading && (
          <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Verificando produção e histórico…
          </div>
        )}

        {impact.isError && (
          <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Não foi possível verificar a ficha: {impact.error.message}
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {!data.can_retire && (
              <div role="alert" className="border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="font-semibold text-destructive">
                  Exclusão bloqueada por produção já realizada ou vínculo inseguro
                </p>
                <p className="mt-1 text-muted-foreground">
                  {blockingReasons.join('; ')}. Concilie os registros indicados antes de retirar a ficha.
                </p>
              </div>
            )}

            <div className="border border-warning/40 bg-warning/10 p-3">
              <p className="text-sm font-semibold text-warning-foreground">
                {data.can_retire
                  ? 'Exclusão segura com histórico preservado'
                  : 'Impacto que será aplicado após a conciliação'}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-foreground">
                <li>
                  <strong>{formatNumber.format(data.active_sale_item_count)} item(ns) de PV</strong>, somando <strong>{formatNumber.format(data.active_sale_item_pairs)} pares</strong>, {data.can_retire ? 'ficarão' : 'poderão ficar'} marcados como retirados da produção e não voltarão pelo MRP ou por uma reedição do pedido.
                </li>
                <li>
                  <strong>{formatNumber.format(data.active_order_count)} OP(s) ativa(s)</strong>, somando <strong>{formatNumber.format(data.active_pairs)} pares</strong>, {data.can_retire ? 'serão canceladas e sairão' : 'poderão ser canceladas e sair'} da fila de produção.
                </li>
                <li>
                  Reservas abertas serão liberadas e baixas reversíveis serão compensadas pelo fluxo canônico de estoque.
                </li>
                <li>
                  <strong>{formatNumber.format(data.historical_order_count)} OP(s) histórica(s)</strong> permanecerão disponíveis para auditoria.
                </li>
                {Number(data.reversible_strap_demand_count || 0) > 0 && (
                  <li>
                    <strong>{formatNumber.format(Number(data.reversible_strap_demand_count))} demanda(s) de tira reversível(is)</strong> serão canceladas e reconciliadas sem apagar o histórico.
                  </li>
                )}
                {Number(data.reversible_service_order_count || 0) > 0 && (
                  <li>
                    <strong>{formatNumber.format(Number(data.reversible_service_order_count))} OS(s) terceirizada(s) reversível(is)</strong> serão canceladas; despachos, retornos e fatos financeiros nunca são alterados automaticamente.
                  </li>
                )}
              </ul>
            </div>

            {data.active_orders.length > 0 && (
              <div className="border border-border">
                <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  OPs {data.can_retire ? 'que sairão da produção' : 'que precisam de conferência'}
                </div>
                <div className="divide-y divide-border">
                  {data.active_orders.map(order => (
                    <div key={order.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-mono font-semibold">{order.order_number || order.id}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.status}
                          {order.has_non_reversible_facts ? ' · apontamento irreversível' : ''}
                          {order.has_terminal_parent ? ` · PV ${order.parent_status || 'terminal'}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-xs tabular-nums">
                        {formatNumber.format(order.quantity)} pares
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preservedLinks.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">Também serão preservados:</p>
                <p className="mt-1">
                  {preservedLinks.map(item => (
                    `${item.count} ${item.count === 1 ? item.singular : item.plural}`
                  )).join(', ')}.
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              A ficha nunca será apagada fisicamente. O item continuará no Pedido de Venda e nos documentos fiscais para preservar o histórico comercial, com aviso permanente de retirada produtiva; a OP ativa será cancelada e também manterá o aviso, além do alerta de produção e da auditoria.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="technical-sheet-delete-reason">Motivo da exclusão</Label>
              <Textarea
                id="technical-sheet-delete-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ex.: ficha duplicada cadastrada por engano"
                rows={3}
                maxLength={500}
                disabled={deleteSheet.isPending}
              />
              <p className="text-xs text-muted-foreground">Mínimo de 10 caracteres. O motivo ficará na auditoria.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="technical-sheet-delete-confirmation">
                Digite <span className="font-mono font-semibold text-foreground">{sheet?.name}</span> para confirmar
              </Label>
              <Input
                id="technical-sheet-delete-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                disabled={deleteSheet.isPending}
              />
            </div>

            {persistentError && (
              <div role="alert" className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {persistentError}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={deleteSheet.isPending}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {deleteSheet.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {deleteSheet.isPending ? 'Excluindo…' : 'Excluir e retirar da produção'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
