import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Download, FileText, Copy, ArrowSquareOut as ExternalLink,
  CircleNotch as Loader2, Warning as AlertTriangle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { NfeEmitida } from '@/hooks/useNfe';
import { useDownloadNfeFile, buildMeudanfeUrl } from '@/hooks/useNfe';

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
 * usando a chave de acesso. A API do GestaoClick não expõe arquivos via
 * endpoint próprio, então o usuário baixa pelos botões da página aberta.
 */
export function NfeViewerDialog({ nfe, open, onOpenChange, clientLabel, orderNumber }: Props) {
  const downloadFile = useDownloadNfeFile();

  if (!nfe) return null;

  const statusInfo = STATUS_VARIANT[nfe.status] || { label: nfe.status, className: 'bg-muted text-muted-foreground' };
  const canDownload = nfe.status === 'autorizada' && !!nfe.chave_acesso;
  const meudanfeUrl = nfe.chave_acesso ? buildMeudanfeUrl(nfe.chave_acesso) : null;

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

        <div className="flex-1 min-h-0 overflow-auto p-6 space-y-4">
          {canDownload ? (
            <>
              <div className="rounded-md border border-border/60 bg-card p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold">DANFE e XML</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Abrir visualizador público (meudanfe.com.br) usando a chave de acesso da NF.
                      Lá tem botão para baixar o PDF do DANFE e o XML autorizado direto da SEFAZ.
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    onClick={() => downloadFile.mutate({ chave: nfe.chave_acesso, format: 'danfe' })}
                    disabled={downloadFile.isPending}
                    className="gap-1.5"
                    size="sm"
                  >
                    {downloadFile.isPending && downloadFile.variables?.format === 'danfe'
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Download className="h-4 w-4" />}
                    Baixar DANFE (PDF)
                  </Button>
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
                    Baixar XML
                  </Button>
                  {meudanfeUrl && (
                    <Button asChild variant="ghost" size="sm" className="gap-1.5">
                      <a href={meudanfeUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" /> Abrir visualizador
                      </a>
                    </Button>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300 flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  A API do GestaoClick não disponibiliza o PDF/XML direto.
                  Os arquivos vêm do meudanfe.com.br pela chave de acesso autorizada na SEFAZ
                  — mesma fonte que o próprio Receita Federal usa.
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-border/60 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              {nfe.status === 'rejeitada' || nfe.status === 'erro'
                ? 'NF rejeitada — DANFE/XML não foram gerados.'
                : nfe.status === 'cancelada'
                  ? 'NF cancelada — você ainda pode baixar o DANFE/XML pelo visualizador público.'
                  : !nfe.chave_acesso
                    ? 'Chave de acesso ainda não disponível. Aguarde a SEFAZ autorizar ou clique em "Verificar status" na lista.'
                    : 'DANFE/XML disponíveis somente após autorização.'}
              {nfe.status === 'cancelada' && nfe.chave_acesso && (
                <div className="mt-3">
                  <Button
                    onClick={() => downloadFile.mutate({ chave: nfe.chave_acesso, format: 'danfe' })}
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                  >
                    <Download className="h-4 w-4" /> Abrir visualizador
                  </Button>
                </div>
              )}
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
