import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, ShieldCheck, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cnpj: string;
  razaoSocial?: string;
  hasCert: boolean;
};

/**
 * Dialog que faz upload do .pfx + senha pra Focus NFe via edge function.
 * NÃO armazena a senha no nosso DB — só Focus NFe a guarda.
 */
export function CertificateSetupDialog({ open, onOpenChange, cnpj, razaoSocial, hasCert }: Props) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setFile(null);
    setPassword('');
    setShowPassword(false);
    setSubmitting(false);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.toLowerCase();
    if (!ext.endsWith('.pfx') && !ext.endsWith('.p12')) {
      toast.error('Selecione um arquivo .pfx ou .p12');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast.error('Arquivo deve ter no máximo 5 MB');
      return;
    }
    setFile(f);
  };

  const handleSubmit = async () => {
    if (!file) {
      toast.error('Selecione o arquivo do certificado');
      return;
    }
    if (!password || password.length < 4) {
      toast.error('Informe a senha do certificado');
      return;
    }
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('cnpj', cnpj);
      formData.append('certificate', file);
      formData.append('password', password);

      const { data, error } = await supabase.functions.invoke('setup-nfe-certificate', {
        body: formData,
      });

      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const validUntil = (data as any)?.cert_valid_until;
      toast.success(
        validUntil
          ? `Certificado configurado. Válido até ${new Date(validUntil).toLocaleDateString('pt-BR')}.`
          : 'Certificado configurado com sucesso.',
      );

      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['companies_cert_status'] });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao configurar certificado');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (!submitting) {
      if (!v) reset();
      onOpenChange(v);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {hasCert ? 'Atualizar Certificado Digital' : 'Configurar Certificado Digital'}
          </DialogTitle>
          <DialogDescription>
            Empresa: <strong>{razaoSocial}</strong> · CNPJ <strong>{cnpj}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1.5">
            <p className="font-semibold text-foreground">Como funciona</p>
            <p className="text-muted-foreground">
              O arquivo <code className="text-foreground">.pfx</code> e a senha são enviados <strong>diretamente
              pra Focus NFe</strong> (provedor de NF-e). O sistema <strong>não armazena</strong> a senha
              — apenas metadados (validade, status) ficam no banco pra mostrar alertas.
            </p>
          </div>

          {hasCert && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 flex items-start gap-2 text-xs">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-amber-800">
                Já existe um certificado configurado pra esta empresa. Ao enviar um novo,
                ele substitui o anterior na Focus NFe.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="cert-file">Arquivo do Certificado A1 (.pfx ou .p12)</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                id="cert-file"
                type="file"
                accept=".pfx,.p12"
                onChange={handleFile}
                disabled={submitting}
                className="flex-1"
              />
            </div>
            {file && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Selecionado: <strong className="text-foreground">{file.name}</strong>
                {' · '}
                {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="cert-password">Senha do Certificado</Label>
            <div className="mt-1.5 relative">
              <Input
                id="cert-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Senha fornecida na hora do download do certificado"
                disabled={submitting}
                className="pr-9"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              A senha NÃO é armazenada no sistema — apenas enviada pra Focus NFe.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !file || !password} className="gap-2">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {hasCert ? 'Atualizar' : 'Configurar'} Certificado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
