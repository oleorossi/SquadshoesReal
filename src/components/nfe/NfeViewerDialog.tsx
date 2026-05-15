import { useEffect, useState } from 'react';
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
 * Visualizador de NF-e: abre num modal grande mostrando o DANFE (iframe PDF)
 * lado a lado com metadados + conteúdo do XML inline. Botões pra baixar
 * ambos os arquivos e abrir em aba nova.
 *
 * Se o DANFE/XML estiverem hosted em domínio com CORS restritivo, o iframe
 * mostra fallback "abrir em nova aba". Mesma coisa pro fetch do XML.
 */
export function NfeViewerDialog({ nfe, open, onOpenChange, clientLabel, orderNumber }: Props) {
  const [xmlText, setXmlText] = useState<string | null>(null);
  const [xmlLoading, setXmlLoading] = useState(false);
  const [xmlError, setXmlError] = useState<string | null>(null);

  // Carrega o XML inline (best-effort — se CORS bloquear, mostra link).
  useEffect(() => {
    if (!open || !nfe?.xml_url) {
      setXmlText(null);
      setXmlError(null);
      return;
    }
    setXmlLoading(true);
    setXmlError(null);
    fetch(nfe.xml_url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(text => setXmlText(text))
      .catch(err => setXmlError(err?.message || 'Falha ao carregar XML'))
      .finally(() => setXmlLoading(false));
  }, [open, nfe?.xml_url]);

  if (!nfe) return null;

  const statusInfo = STATUS_VARIANT[nfe.status] || { label: nfe.status, className: 'bg-muted text-muted-foreground' };
  const hasDanfe = !!nfe.danfe_url;
  const hasXml = !!nfe.xml_url;

  const handleCopyXml = async () => {
    if (!xmlText) return;
    try {
      await navigator.clipboard.writeText(xmlText);
      toast.success('XML copiado');
    } catch {
      toast.error('Falha ao copiar — selecione manualmente');
    }
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
      <DialogContent className="max-w-6xl max-h-[92vh] flex flex-col p-0 gap-0">
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
            Visualização da NF-e com DANFE e arquivo XML.
          </DialogDescription>
        </DialogHeader>

        {/* Metadados em barra horizontal */}
        <div className="px-6 py-3 border-b border-border/60 bg-muted/30 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
          <div>
            <div className="text-muted-foreground uppercase tracking-wider text-[10px]">Destinatário</div>
            <div className="font-medium truncate" title={clientLabel || nfe.nome_destinatario || ''}>
              {clientLabel || nfe.nome_destinatario || '—'}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase tracking-wider text-[10px]">CNPJ Destinatário</div>
            <div className="font-mono">{formatCnpj(nfe.cnpj_destinatario) || '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase tracking-wider text-[10px]">Emitente</div>
            <div className="font-mono">{formatCnpj(nfe.cnpj_emitente) || '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase tracking-wider text-[10px]">Valor Total</div>
            <div className="font-bold">
              R$ {Number(nfe.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="col-span-2 md:col-span-3">
            <div className="text-muted-foreground uppercase tracking-wider text-[10px]">Chave de Acesso</div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] truncate">{formatChave(nfe.chave_acesso)}</span>
              {nfe.chave_acesso && (
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleCopyChave} title="Copiar chave">
                  <Copy className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase tracking-wider text-[10px]">Emissão</div>
            <div>
              {nfe.data_emissao
                ? new Date(nfe.data_emissao).toLocaleString('pt-BR')
                : new Date(nfe.created_at).toLocaleString('pt-BR')}
            </div>
          </div>
          {nfe.motivo_rejeicao && (
            <div className="col-span-full">
              <div className="text-red-600 uppercase tracking-wider text-[10px] font-bold flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Motivo Rejeição
              </div>
              <div className="text-red-700 text-xs">{nfe.motivo_rejeicao}</div>
            </div>
          )}
          {nfe.protocolo_cancelamento && (
            <div className="col-span-full">
              <div className="text-muted-foreground uppercase tracking-wider text-[10px]">Protocolo Cancelamento</div>
              <div className="font-mono text-[11px]">{nfe.protocolo_cancelamento}</div>
            </div>
          )}
        </div>

        {/* Corpo: DANFE iframe à esquerda, XML à direita */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 min-h-0 overflow-hidden">
          {/* DANFE */}
          <div className="flex flex-col border-r border-border/60 min-h-0">
            <div className="px-4 py-2 border-b border-border/60 flex items-center justify-between bg-muted/20">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">DANFE (PDF)</span>
              <div className="flex items-center gap-1">
                {hasDanfe && (
                  <>
                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild title="Abrir em nova aba">
                      <a href={nfe.danfe_url!} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild title="Baixar DANFE">
                      <a href={nfe.danfe_url!} download target="_blank" rel="noopener noreferrer">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-muted/10">
              {hasDanfe ? (
                <iframe
                  src={nfe.danfe_url!}
                  title="DANFE"
                  className="w-full h-full border-0"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
                  {nfe.status === 'rejeitada' || nfe.status === 'erro'
                    ? 'NF rejeitada — DANFE não foi gerado.'
                    : 'DANFE ainda não disponível. Tente verificar status.'}
                </div>
              )}
            </div>
          </div>

          {/* XML */}
          <div className="flex flex-col min-h-0">
            <div className="px-4 py-2 border-b border-border/60 flex items-center justify-between bg-muted/20">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">XML</span>
              <div className="flex items-center gap-1">
                {xmlText && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopyXml} title="Copiar XML">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                )}
                {hasXml && (
                  <>
                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild title="Abrir em nova aba">
                      <a href={nfe.xml_url!} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild title="Baixar XML">
                      <a href={nfe.xml_url!} download target="_blank" rel="noopener noreferrer">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-muted/5">
              {xmlLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando XML...
                </div>
              ) : xmlError ? (
                <div className="p-4 text-xs space-y-2">
                  <div className="text-amber-700 dark:text-amber-400 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">Não foi possível carregar o XML inline</div>
                      <div className="text-muted-foreground mt-0.5">{xmlError}</div>
                      <div className="text-muted-foreground mt-1">
                        Use os botões acima pra abrir em nova aba ou baixar o arquivo.
                      </div>
                    </div>
                  </div>
                </div>
              ) : xmlText ? (
                <pre className="p-4 text-[10px] font-mono leading-tight whitespace-pre-wrap break-all text-foreground/90">
                  {xmlText}
                </pre>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
                  {nfe.status === 'rejeitada' || nfe.status === 'erro'
                    ? 'NF rejeitada — XML não foi gerado.'
                    : 'XML ainda não disponível.'}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t border-border/60">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
