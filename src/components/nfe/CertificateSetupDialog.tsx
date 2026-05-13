import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShieldCheck, ArrowSquareOut as ExternalLink } from '@phosphor-icons/react';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cnpj: string;
  razaoSocial?: string;
  hasCert: boolean;
};

/**
 * Após a migração pra GestaoClick (mai/2026), o certificado A1 é gerenciado
 * direto no painel deles — não existe endpoint público de upload. Este dialog
 * orienta o usuário a configurar lá.
 */
export function CertificateSetupDialog({ open, onOpenChange, cnpj, razaoSocial, hasCert }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Certificado Digital
          </DialogTitle>
          <DialogDescription>
            Empresa: <strong>{razaoSocial}</strong> · CNPJ <strong>{cnpj}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-2">
            <p className="font-semibold text-foreground">Configuração agora é no painel GestaoClick</p>
            <p className="text-muted-foreground">
              Desde mai/2026 a Squad Shoes usa o <strong>GestaoClick (ClickNotas)</strong> como provedor de
              NF-e. O certificado A1 (.pfx) é instalado direto no painel deles — nosso sistema apenas
              consome a API pra emitir/cancelar/consultar notas.
            </p>
            <p className="text-muted-foreground">
              Acesse o painel, vá em <strong>Configurações → Certificado Digital</strong> e faça o upload
              do .pfx + senha. Depois disso, qualquer emissão a partir do Squad Shoes vai usar o
              certificado configurado.
            </p>
          </div>
          {hasCert && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              ✓ Status atual: certificado ativo no GestaoClick.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button asChild>
            <a href="https://app.clicknotas.com" target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" /> Abrir painel GestaoClick
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
