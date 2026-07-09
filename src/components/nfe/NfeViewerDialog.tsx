import { useRef, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Download, FileText, Copy, ArrowSquareOut as ExternalLink,
  CircleNotch as Loader2, Warning as AlertTriangle, Printer,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { NfeEmitida } from '@/hooks/useNfe';
import { useDownloadNfeFile, buildMeudanfeUrl, useNfeDetail } from '@/hooks/useNfe';
import { DanfeView } from '@/components/nfe/DanfeView';
import { buildDanfeModel } from '@/lib/danfe';
import { printDanfeNode } from '@/lib/printDanfe';

interface Props {
  nfe: NfeEmitida | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Nome do cliente / destinatário (resolvido pelo caller via PV ou nfe.nome_destinatario). */
  clientLabel?: string;
  /** Número do PV vinculado (opcional). */
  orderNumber?: string;
}

const STATUS_VARIANT: Record<string, { label: string; className: string }> = {
  autorizada: { label: 'Autorizada', className: 'bg-green-500/10 text-green-700 border-green-500/30' },
  processando: { label: 'Processando', className: 'bg-amber-500/10 text-amber-700 border-amber-500/30' },
  cancelada: { label: 'Cancelada', className: 'bg-red-500/10 text-red-700 border-red-500/30' },
  rejeitada: { label: 'Rejeitada', className: 'bg-red-500/10 text-red-700 border-red-500/30' },
  erro: { label: 'Erro', className: 'bg-red-500/10 text-red-700 border-red-500/30' },
};

function formatChave(chave: string | null) {
  if (!chave) return '—';
  return chave.replace(/(.{4})/g, '$1 ').trim();
}

function formatCnpj(cnpj: string | null) {
  if (!cnpj) return '';
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return cnpj;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

/**
 * Visualizador de NF-e: mostra metadados (destinatário, chave, valor, status)
 * e oferece botões pra abrir DANFE + XML no viewer público meudanfe.com.br
 * usando a chave de acesso. A API do ClickNotas não expõe arquivos via
 * endpoint próprio, então o usuário baixa pelos botões da página aberta.
 */
export function NfeViewerDialog({ nfe, open, onOpenChange, clientLabel, orderNumber }: Props) {
  const downloadFile = useDownloadNfeFile();
  const danfeRef = useRef<HTMLDivElement>(null);

  // Carrega o detalhe completo (gc_detail_response) sob demanda quando o
  // viewer abre — a listagem não traz esse JSON pra ficar leve.
  const detailQuery = useNfeDetail(nfe?.id, open && !!nfe?.id);

  // Modelo do DANFE: mescla o detalhe carregado com a linha já em mãos.
  const danfeModel = useMemo(() => {
    if (!nfe) return null;
    const merged = detailQuery.data?.gc_detail_response
      ? { ...nfe, gc_detail_response: detailQuery.data.gc_detail_response }
      : nfe;
    return buildDanfeModel(merged);
  }, [nfe, detailQuery.data]);

  if (!nfe) return null;

  const statusInfo = STATUS_VARIANT[nfe.status] || { label: nfe.status, className: 'bg-muted text-muted-foreground' };
  const canDownload = nfe.status === 'autorizada' && !!nfe.chave_acesso;
  const meudanfeUrl = nfe.chave_acesso ? buildMeudanfeUrl(nfe.chave_acesso) : null;
  // Mostra o DANFE renderizado sempre que houver chave ou itens detalhados.
  const canShowDanfe = !!(danfeModel && (danfeModel.chave || danfeModel.produtos.length > 0));

  const handlePrint = () => {
    if (!danfeRef.current) {
      toast.error('DANFE ainda não está pronto — aguarde carregar.');
      return;
    }
    printDanfeNode(danfeRef.current, `DANFE NF ${nfe.numero || ''}`);
  };

  const handleCopyChave = async () => {
    if (!nfe.chave_acesso) return;
    try {
      await navigator.clipboard.writeText(nfe.chave_acesso);
      toast.success('Chave de acesso copiada');
    } catch {
      toast.error('Falha ao copiar');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-5xl max-h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/60">
          <DialogTitle className="flex items-center gap-3 flex-wrap">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <span>NF-e {nfe.numero ? `nº ${nfe.numero}/${nfe.serie || '1'}` : '(sem número)'}</span>
            <Badge variant="outline" className={statusInfo.className}>
              {statusInfo.label}
            </Badge>
            {orderNumber && (
              <span className="text-sm font-normal text-muted-foreground">PV {orderNumber}</span>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Visualização da NF-e com botões para abrir DANFE e XML.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 border-b border-border/60 bg-muted/30 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
          <div>
            <div className="text-muted-foreground uppercase tracking-wider text-xs">Destinatário</div>
            <div className="font-medium truncate" title={clientLabel || nfe.nome_destinatario || ''}>
              {clientLabel || nfe.nome_destinatario || '—'}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase tracking-wider text-xs">CNPJ Destinatário</div>
            <div className="font-mono">{formatCnpj(nfe.cnpj_destinatario) || '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase tracking-wider text-xs">Emitente</div>
            <div className="font-mono">{formatCnpj(nfe.cnpj_emitente) || '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase tracking-wider text-xs">Valor Total</div>
            <div className="font-bold">
              R$ {Number(nfe.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="col-span-2 md:col-span-3">
            <div className="text-muted-foreground uppercase tracking-wider text-xs">Chave de Acesso</div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs truncate">{formatChave(nfe.chave_acesso)}</span>
              {nfe.chave_acesso && (
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleCopyChave} title="Copiar chave">
                  <Copy className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase tracking-wider text-xs">Emissão</div>
            <div>
              {nfe.data_emissao
                ? new Date(nfe.data_emissao).toLocaleString('pt-BR')
                : new Date(nfe.created_at).toLocaleString('pt-BR')}
            </div>
          </div>
          {nfe.motivo_rejeicao && (
            <div className="col-span-full">
              <div className="text-red-600 uppercase tracking-wider text-xs font-bold flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Motivo Rejeição
              </div>
              <div className="text-red-700 text-xs">{nfe.motivo_rejeicao}</div>
            </div>
          )}
          {nfe.protocolo_cancelamento && (
            <div className="col-span-full">
              <div className="text-muted-foreground uppercase tracking-wider text-xs">Protocolo Cancelamento</div>
              <div className="font-mono text-xs">{nfe.protocolo_cancelamento}</div>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-muted/30 p-4 space-y-3">
          {canShowDanfe ? (
            <>
              {/* Toolbar de ações do documento */}
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handlePrint} disabled={detailQuery.isLoading} className="gap-1.5" size="sm">
                  {detailQuery.isLoading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Printer className="h-4 w-4" />}
                  Imprimir / Salvar PDF
                </Button>
                {canDownload && (
                  <Button
                    onClick={() => downloadFile.mutate({ chave: nfe.chave_acesso, format: 'xml' })}
                    disabled={downloadFile.isPending}
                    variant="outline"
                    className="gap-1.5"
                    size="sm"
                  >
                    {downloadFile.isPending && downloadFile.variables?.format === 'xml'
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Download className="h-4 w-4" />}
                    Baixar XML oficial
                  </Button>
                )}
                {meudanfeUrl && (
                  <Button asChild variant="ghost" size="sm" className="gap-1.5">
                    <a href={meudanfeUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" /> DANFE/XML na SEFAZ
                    </a>
                  </Button>
                )}
                {detailQuery.isLoading && (
                  <span className="text-xs text-muted-foreground">Carregando itens da nota…</span>
                )}
              </div>

              {/* DANFE renderizado no app */}
              <div className="rounded-md border border-border/60 bg-card shadow-sm overflow-x-auto">
                {danfeModel && <DanfeView ref={danfeRef} model={danfeModel} />}
              </div>

              <div className="text-xs text-muted-foreground flex gap-2 px-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Esta é a representação interna do DANFE gerada com os dados da NF.
                  Para o XML/DANFE oficial autorizado, use os botões acima (SEFAZ via chave de acesso).
                </span>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-border/60 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              {detailQuery.isLoading
                ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Carregando dados da nota…</span>
                : nfe.status === 'rejeitada' || nfe.status === 'erro'
                  ? 'NF rejeitada — DANFE não foi gerado.'
                  : !nfe.chave_acesso
                    ? 'Chave de acesso ainda não disponível. Aguarde a SEFAZ autorizar ou clique em "Verificar status" na lista.'
                    : 'DANFE disponível somente após autorização.'}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-3 border-t border-border/60">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
