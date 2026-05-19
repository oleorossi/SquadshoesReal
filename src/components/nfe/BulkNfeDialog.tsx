import { useEffect, useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CircleNotch as Loader2, Warning as AlertTriangle, CheckCircle, X, Receipt, CaretDown as ChevronDown, CaretRight as ChevronRight } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { NfePreviewPanel } from './NfePreviewPanel';
import type { NfePreviewResponse } from '@/hooks/useNfe';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** PVs a processar. Display extra (number, client) é só pra UI. */
  saleOrders: Array<{ id: string; order_number: string; client_name?: string | null }>;
  /** Quando true, abre direto em modo emissão. Senão fica em modo preview até user confirmar. */
  mode: 'preview' | 'emit';
}

interface PvState {
  id: string;
  order_number: string;
  client_name?: string | null;
  status: 'pending' | 'previewing' | 'preview_ok' | 'preview_error' | 'emitting' | 'emitted' | 'emit_error';
  preview?: NfePreviewResponse['preview'];
  errorMsg?: string;
  expanded?: boolean;
}

/** Chama emit-nfe (dry_run ou real) com fetch direto pra extrair msg específica. */
async function callEmitNfe(saleOrderId: string, dryRun: boolean): Promise<{ ok: boolean; data?: any; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, error: 'Sessão expirada' };

  const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL;
  const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/emit-nfe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_KEY,
      },
      body: JSON.stringify({ sale_order_id: saleOrderId, dry_run: dryRun }),
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { /* não-JSON */ }

    if (!res.ok) {
      return { ok: false, error: parsed?.error || txt || `HTTP ${res.status}` };
    }
    if (parsed?.error) return { ok: false, error: String(parsed.error), data: parsed };
    return { ok: true, data: parsed };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Falha de rede' };
  }
}

export function BulkNfeDialog({ open, onOpenChange, saleOrders, mode }: Props) {
  const [stage, setStage] = useState<'preview' | 'confirm' | 'emitting' | 'done'>('preview');
  const [items, setItems] = useState<PvState[]>([]);
  const qc = useQueryClient();

  // Inicializa quando abre — dispara previews em paralelo
  useEffect(() => {
    if (!open) return;
    const initial: PvState[] = saleOrders.map(so => ({
      id: so.id, order_number: so.order_number, client_name: so.client_name,
      status: 'previewing', expanded: false,
    }));
    setItems(initial);
    setStage('preview');

    // Previews em PARALELO (dry_run não chama GestaoClick — só monta payload)
    Promise.all(saleOrders.map(async (so) => {
      const r = await callEmitNfe(so.id, true);
      return { id: so.id, r };
    })).then(results => {
      setItems(prev => prev.map(it => {
        const hit = results.find(x => x.id === it.id);
        if (!hit) return it;
        if (hit.r.ok && hit.r.data?.preview) {
          return { ...it, status: 'preview_ok', preview: hit.r.data.preview };
        }
        return { ...it, status: 'preview_error', errorMsg: hit.r.error || 'Falha desconhecida' };
      }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saleOrders.map(s => s.id).join(',')]);

  const stats = useMemo(() => ({
    total: items.length,
    previewing: items.filter(i => i.status === 'previewing').length,
    previewOk: items.filter(i => i.status === 'preview_ok').length,
    previewErr: items.filter(i => i.status === 'preview_error').length,
    emitting: items.filter(i => i.status === 'emitting').length,
    emitted: items.filter(i => i.status === 'emitted').length,
    emitErr: items.filter(i => i.status === 'emit_error').length,
  }), [items]);

  const emitableIds = items.filter(i => i.status === 'preview_ok').map(i => i.id);

  const toggleExpand = (id: string) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, expanded: !it.expanded } : it));
  };

  /** Emite em SEQUÊNCIA (não paralelo) pra não estourar rate-limit do GestaoClick. */
  const handleEmitAll = async () => {
    if (emitableIds.length === 0) return;
    const ok = window.confirm(
      `EMITIR ${emitableIds.length} NF-e${emitableIds.length === 1 ? '' : 's'} agora?\n\n` +
      'Cada NF vai ser enviada pro GestaoClick em sequência (~3-5s cada). ' +
      'Não dá pra cancelar no meio. PVs com erro de preview são pulados.\n\n' +
      'Confirmar emissão?'
    );
    if (!ok) return;

    setStage('emitting');
    for (const id of emitableIds) {
      setItems(prev => prev.map(it => it.id === id ? { ...it, status: 'emitting' } : it));
      const r = await callEmitNfe(id, false);
      if (r.ok) {
        setItems(prev => prev.map(it => it.id === id ? { ...it, status: 'emitted' } : it));
      } else {
        setItems(prev => prev.map(it => it.id === id ? { ...it, status: 'emit_error', errorMsg: r.error } : it));
      }
    }
    setStage('done');
    qc.invalidateQueries({ queryKey: ['sale_orders'] });
    qc.invalidateQueries({ queryKey: ['nfe_emitidas'] });
    toast.success('Emissão em lote concluída — confira o resumo no dialog.');
  };

  const allPreviewed = stats.previewing === 0;
  const progressValue = stage === 'emitting' || stage === 'done'
    ? ((stats.emitted + stats.emitErr) / Math.max(1, emitableIds.length)) * 100
    : (allPreviewed ? 100 : ((stats.previewOk + stats.previewErr) / Math.max(1, items.length)) * 100);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            {stage === 'done' ? 'Emissão concluída' : mode === 'emit' ? 'Emitir NF-e em Lote' : 'Preview de NF-e em Lote'}
          </DialogTitle>
          <DialogDescription>
            {stage === 'done'
              ? 'Confira o resultado de cada PV abaixo. NFs em erro podem ser re-emitidas individualmente em /nfe.'
              : `${saleOrders.length} pedido${saleOrders.length === 1 ? '' : 's'} selecionado${saleOrders.length === 1 ? '' : 's'}. Clique em cada um pra expandir o preview da NF.`}
          </DialogDescription>
        </DialogHeader>

        {/* Barra de progresso */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {stage === 'emitting' ? `Emitindo... ${stats.emitted + stats.emitErr}/${emitableIds.length}`
                : stage === 'done' ? `${stats.emitted} emitidas · ${stats.emitErr} com erro`
                : stats.previewing > 0 ? `Gerando previews... ${stats.previewOk + stats.previewErr}/${items.length}`
                : `${stats.previewOk} OK · ${stats.previewErr} com erro de preview`}
            </span>
            <div className="flex gap-1">
              {stats.previewOk > 0 && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px]">{stats.previewOk} OK</Badge>}
              {stats.previewErr > 0 && <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 text-[10px]">{stats.previewErr} erro</Badge>}
              {stats.emitted > 0 && <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 text-[10px]">{stats.emitted} emitidas</Badge>}
            </div>
          </div>
          <Progress value={progressValue} className="h-1.5" />
        </div>

        {/* Lista de PVs com accordion */}
        <div className="space-y-2 mt-2">
          {items.map(it => (
            <div key={it.id} className="rounded-md border overflow-hidden">
              <button
                type="button"
                onClick={() => it.preview && toggleExpand(it.id)}
                disabled={!it.preview}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  it.preview ? 'hover:bg-muted/40 cursor-pointer' : 'cursor-default'
                }`}
              >
                {it.preview ? (
                  it.expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <div className="w-4" />
                )}

                {/* Status icon */}
                {it.status === 'previewing' && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
                {it.status === 'preview_ok' && <CheckCircle className="h-4 w-4 text-emerald-600" />}
                {it.status === 'preview_error' && <X className="h-4 w-4 text-red-600" />}
                {it.status === 'emitting' && <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />}
                {it.status === 'emitted' && <CheckCircle className="h-4 w-4 text-blue-600" />}
                {it.status === 'emit_error' && <AlertTriangle className="h-4 w-4 text-red-600" />}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold">{it.order_number}</span>
                    {it.client_name && <span className="text-xs text-muted-foreground truncate">{it.client_name}</span>}
                  </div>
                  {it.status === 'preview_error' && it.errorMsg && (
                    <p className="text-[11px] text-red-600 mt-0.5 truncate">{it.errorMsg}</p>
                  )}
                  {it.status === 'emit_error' && it.errorMsg && (
                    <p className="text-[11px] text-red-600 mt-0.5">{it.errorMsg}</p>
                  )}
                  {it.status === 'emitted' && (
                    <p className="text-[11px] text-emerald-600 mt-0.5">NF-e enviada ao GestaoClick com sucesso.</p>
                  )}
                </div>

                {it.status === 'preview_ok' && it.preview?.totais && (
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(it.preview.totais.valor_total)}
                  </Badge>
                )}
              </button>

              {it.expanded && it.preview && (
                <div className="border-t bg-muted/20 p-4">
                  <NfePreviewPanel preview={it.preview} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Ações no rodapé */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t mt-3">
          <div className="text-xs text-muted-foreground">
            {stage === 'done' ? 'Pode fechar este dialog.' : `${emitableIds.length} pronto${emitableIds.length === 1 ? '' : 's'} pra emissão`}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {stage === 'done' ? 'Fechar' : 'Cancelar'}
            </Button>
            {stage !== 'done' && stage !== 'emitting' && (
              <Button
                onClick={handleEmitAll}
                disabled={!allPreviewed || emitableIds.length === 0}
                className="gap-1.5"
              >
                <Receipt className="h-4 w-4" />
                Emitir {emitableIds.length} NF-e{emitableIds.length === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
