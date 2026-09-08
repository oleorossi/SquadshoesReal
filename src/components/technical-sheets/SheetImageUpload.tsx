import { useState } from 'react';
import { CircleNotch as Loader2, ImageSquare as ImagePlus, Trash as Trash2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { SignedImage } from '@/components/ui/signed-image';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/* ===== SHEET IMAGE UPLOAD ===== */
export function SheetImageUpload({ images, onChange }: { images: any[]; onChange: (imgs: any[]) => void }) {
  const [uploading, setUploading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const currentUrl = Array.isArray(images) && images.length > 0 ? (typeof images[0] === 'string' ? images[0] : null) : null;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('reference-images').upload(fileName, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('reference-images').getPublicUrl(fileName);
      onChange([publicUrl]);
      toast.success('Imagem enviada!');
    } catch (err: any) {
      toast.error(`Erro ao enviar imagem: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="flex items-start gap-4">
        {currentUrl ? (
          <div className="relative group">
            <div className="w-80 h-80 rounded-xl border-2 border-border overflow-hidden bg-muted cursor-zoom-in shadow-sm hover:shadow-md transition-shadow"
              onClick={() => setLightboxOpen(true)}>
              <img src={currentUrl} alt="Produto" className="w-full h-full object-cover" />
            </div>
            <div className="absolute top-2 right-2 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <label className="cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                <div className="h-7 w-7 rounded-md bg-background/90 backdrop-blur border border-border flex items-center justify-center hover:bg-accent transition-colors">
                  <ImagePlus className="h-3.5 w-3.5 text-foreground" />
                </div>
              </label>
              <Button type="button" variant="destructive" size="icon" aria-label="Remover foto" className="h-7 w-7 rounded-md"
                onClick={(e) => { e.stopPropagation(); onChange([]); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <label className="cursor-pointer flex flex-col items-center justify-center w-80 h-80 rounded-xl border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-all bg-muted/20 hover:bg-muted/40">
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
            {uploading ? <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /> : (
              <>
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-3">
                  <ImagePlus className="h-7 w-7 text-muted-foreground/60" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Adicionar foto</span>
                <span className="text-xs text-muted-foreground/60 mt-1">JPG, PNG ou WebP</span>
              </>
            )}
          </label>
        )}
      </div>
      {lightboxOpen && currentUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setLightboxOpen(false)}>
          <img src={currentUrl} alt="Produto ampliado" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

