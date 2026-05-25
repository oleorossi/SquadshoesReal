import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle, UploadSimple, X } from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { uploadSignedReceiptPhoto } from '@/lib/serviceOrderStock';

/**
 * Dialog pra anexar foto do recibo assinado pelo prestador.
 * Suporta câmera (input capture=environment) E upload de arquivo do disco.
 * Após upload, atualiza service_orders.signed_photo_url + marca status='received'
 * (opcional via prop markAsReceived).
 */

export interface SignedReceiptUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceOrderId: string | null;
  orderLabel?: string;       // "OS REC-2026-00012" ou similar
  contractorName?: string;
  markAsReceived?: boolean;  // se true, status='received' após upload
  onSuccess?: () => void;
}

export function SignedReceiptUploadDialog({
  open, onOpenChange, serviceOrderId, orderLabel, contractorName, markAsReceived = true, onSuccess,
}: SignedReceiptUploadDialogProps) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setPreview(null);
    }
  }, [open]);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  }, [file]);

  const upload = useMutation({
    mutationFn: async () => {
      if (!serviceOrderId) throw new Error('OS sem id.');
      if (!file) throw new Error('Selecione uma foto.');
      const { url } = await uploadSignedReceiptPhoto(serviceOrderId, file);
      const patch: any = { signed_photo_url: url };
      if (markAsReceived) patch.status = 'received';
      const { error } = await (supabase as any)
        .from('service_orders')
        .update(patch)
        .eq('id', serviceOrderId);
      if (error) throw new Error(error.message);
      return url;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['v_outsourced_in_field'] });
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_history_orders'] });
      toast.success(
        markAsReceived
          ? 'Foto do recibo anexada e OS marcada como recebida.'
          : 'Foto do recibo anexada.',
      );
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Falha ao enviar foto.');
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !upload.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            Foto do recibo assinado
          </DialogTitle>
          <DialogDescription>
            Anexe a foto do recibo assinado pelo prestador{contractorName ? ` (${contractorName})` : ''}.
            {markAsReceived && (
              <span className="block mt-1 text-xs text-foreground">
                A OS será marcada como <strong>recebida</strong> ao confirmar.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {orderLabel && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
              <span className="text-muted-foreground">Documento: </span>
              <span className="font-mono font-semibold">{orderLabel}</span>
            </div>
          )}

          {!preview ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-24 flex-col gap-2"
                onClick={() => cameraRef.current?.click()}
              >
                <Camera className="h-6 w-6" />
                <span className="text-xs">Tirar foto</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-24 flex-col gap-2"
                onClick={() => inputRef.current?.click()}
              >
                <UploadSimple className="h-6 w-6" />
                <span className="text-xs">Escolher arquivo</span>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative rounded-md border border-border overflow-hidden bg-muted/30">
                <img
                  src={preview}
                  alt="Pré-visualização da foto do recibo"
                  className="w-full max-h-[400px] object-contain"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute top-2 right-2 h-7 w-7"
                  onClick={() => { setFile(null); setPreview(null); }}
                  aria-label="Remover foto"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate max-w-[60%]" title={file?.name}>
                  {file?.name}
                </span>
                {file && (
                  <span className="tabular-nums">
                    {(file.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB
                  </span>
                )}
              </div>
            </div>
          )}

          {/* inputs ocultos */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile(f);
              e.target.value = '';
            }}
          />
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile(f);
              e.target.value = '';
            }}
          />

          <Label className="text-[11px] text-muted-foreground block">
            Aceita imagens (jpg, png) e PDF. Foto guardada com segurança no Storage (acesso só pra usuários autenticados).
          </Label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={upload.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => upload.mutate()}
            disabled={!file || upload.isPending}
          >
            {upload.isPending ? (
              'Enviando...'
            ) : (
              <>
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                {markAsReceived ? 'Anexar e marcar recebido' : 'Anexar foto'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
