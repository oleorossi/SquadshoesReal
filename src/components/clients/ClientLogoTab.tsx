import { useState } from 'react';
import { Upload, Trash as Trash2, CircleNotch as Loader2, Image } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  clientId: string | null;
  logoUrl: string;
  onLogoChange: (url: string) => void;
}

export default function ClientLogoTab({ clientId, logoUrl, onLogoChange }: Props) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Imagem deve ter no máximo 5MB.');
      return;
    }

    setUploading(true);
    try {
      const safeExt = (file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '');
      const path = `${clientId || crypto.randomUUID()}/silk-logo.${safeExt}`;

      // Remove old file if exists
      if (logoUrl) {
        const oldPath = logoUrl.split('/client-logos/')[1];
        if (oldPath) {
          await supabase.storage.from('client-logos').remove([oldPath]);
        }
      }

      const { error } = await supabase.storage.from('client-logos').upload(path, file, { upsert: true });
      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage.from('client-logos').getPublicUrl(path);
      onLogoChange(publicUrl);
      toast.success('Logo do SILK enviada com sucesso!');
    } catch (err: any) {
      toast.error(`Erro ao enviar: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (logoUrl) {
      const oldPath = logoUrl.split('/client-logos/')[1];
      if (oldPath) {
        await supabase.storage.from('client-logos').remove([oldPath]);
      }
    }
    onLogoChange('');
    toast.success('Logo removida.');
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-semibold flex items-center gap-2">
          <Image className="h-4 w-4" />
          Logo do SILK
        </Label>
        <p className="text-xs text-muted-foreground mt-1">
          Esta imagem aparecerá em todas as fichas de produção (Corte, Aviamento, Acabamento, Solagem).
          Se não houver logo, será usada a logomarca da Squad Shoes.
        </p>
      </div>

      {logoUrl ? (
        <div className="space-y-3">
          <div className="border rounded-lg p-4 bg-muted/30 flex items-center justify-center">
            <img
              src={logoUrl}
              alt="Logo SILK do cliente"
              className="max-w-[200px] max-h-[200px] object-contain"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRemove}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remover
            </Button>
            <label>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" asChild>
                <span>
                  <Upload className="h-3.5 w-3.5" />
                  Trocar imagem
                </span>
              </Button>
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            </label>
          </div>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer hover:bg-muted/50 transition-colors">
          {uploading ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <>
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <span className="text-sm text-muted-foreground">Clique para enviar a logo do SILK</span>
              <span className="text-xs text-muted-foreground mt-1">PNG, JPG ou SVG (máx. 5MB)</span>
            </>
          )}
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      )}
    </div>
  );
}
