import { useRef, useState } from 'react';
import { CircleNotch, Image, Trash, UploadSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg']);

interface Props {
  clientId: string;
  logoUrl: string | null;
  disabled?: boolean;
  onLogoChange: (url: string | null) => void;
}

function extensionOf(file: File): 'png' | 'jpg' | null {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName === 'png' || file.type === 'image/png') return 'png';
  if (fromName === 'jpg' || fromName === 'jpeg' || file.type === 'image/jpeg') return 'jpg';
  return null;
}

function storagePathFromPublicUrl(url: string): string | null {
  const marker = '/client-logos/';
  const index = url.indexOf(marker);
  if (index < 0) return null;
  const path = url.slice(index + marker.length);
  return path.length > 0 ? path : null;
}

export function ClientLabelLogoUpload({ clientId, logoUrl, disabled, onLogoChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function removeStored(url: string | null) {
    if (!url) return;
    const oldPath = storagePathFromPublicUrl(url);
    if (oldPath) {
      await supabase.storage.from('client-logos').remove([oldPath]);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file || disabled) return;
    if (file.size > MAX_LOGO_BYTES) {
      toast.error('Imagem deve ter no máximo 5MB.');
      return;
    }
    const ext = extensionOf(file);
    if (!ext || (file.type && !ACCEPTED_TYPES.has(file.type))) {
      toast.error('Envie PNG ou JPG. O PDF da hangtag não desenha SVG.');
      return;
    }

    setUploading(true);
    try {
      const path = `${clientId}/label-logo-objetiva.${ext}`;
      if (logoUrl) {
        const oldPath = storagePathFromPublicUrl(logoUrl);
        if (oldPath && oldPath !== path) {
          await supabase.storage.from('client-logos').remove([oldPath]);
        }
      }
      const { error } = await supabase.storage.from('client-logos').upload(path, file, {
        upsert: true,
        contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
      });
      if (error) throw error;
      const {
        data: { publicUrl },
      } = supabase.storage.from('client-logos').getPublicUrl(path);
      onLogoChange(`${publicUrl}?t=${Date.now()}`);
      toast.success('Logomarca enviada. Salve o padrão do cliente para gravar.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não consegui enviar a logomarca.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    if (disabled) return;
    setUploading(true);
    try {
      await removeStored(logoUrl);
      onLogoChange(null);
      toast.success('Logomarca removida. Salve o padrão do cliente para gravar.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não consegui remover a logomarca.');
    } finally {
      setUploading(false);
    }
  }

  const busy = Boolean(disabled) || uploading;

  return (
    <div className="space-y-2">
      <Label className="text-xs">Logomarca do cliente</Label>
      <p className="text-xs text-muted-foreground">
        Aparece no canto superior da hangtag Objetiva. PNG ou JPG, máximo 5 MB.
      </p>
      <input
        ref={inputRef}
        id="objetiva-logo-upload"
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        className="hidden"
        disabled={busy}
        onChange={event => void handleFile(event.target.files?.[0])}
      />
      {logoUrl ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex h-16 w-28 items-center justify-center overflow-hidden rounded-sm border border-border bg-background">
            <img src={logoUrl} alt="Logomarca do cliente na hangtag" className="max-h-16 max-w-28 object-contain" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <CircleNotch className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <UploadSimple className="h-4 w-4 mr-1.5" />
              )}
              Trocar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => void handleRemove()}
            >
              <Trash className="h-4 w-4 mr-1.5" />
              Remover
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-muted-foreground hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-50"
        >
          {uploading ? (
            <CircleNotch className="h-6 w-6 animate-spin" />
          ) : (
            <>
              <Image className="mb-1 h-6 w-6" />
              <span className="text-sm">Enviar logomarca</span>
              <span className="mt-0.5 text-xs">PNG ou JPG</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
