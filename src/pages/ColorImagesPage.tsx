import { useState, useRef } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { SignedImage } from '@/components/ui/signed-image';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useColorVariants, useUpdateColorVariant, recolorImage } from '@/hooks/useColorVariants';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, Upload, Wand2, ImageOff, CheckCircle2, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Upload helper ────────────────────────────────────────────────────────────
async function uploadVariantImage(file: File, variantId: string): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Imagem deve ter no máximo 10MB.');
  const safeExt = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-zA-Z0-9]/g, '');
  const path = `variant-${variantId}-${Date.now()}.${safeExt}`;
  const { error } = await supabase.storage
    .from('reference-images')
    .upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('reference-images').getPublicUrl(path);
  return data.publicUrl;
}

// ─── Color swatch ─────────────────────────────────────────────────────────────
function ColorSwatch({ hex, size = 14 }: { hex?: string; size?: number }) {
  if (!hex) return null;
  return (
    <span
      className="inline-block rounded-sm border border-border/60 shrink-0"
      style={{ width: size, height: size, background: hex }}
    />
  );
}

// ─── Single variant card ──────────────────────────────────────────────────────
function VariantCard({
  variant,
  fallbackImageUrl,
  sheetCode,
}: {
  variant: { id: string; color: string; image_url: string; hex_code: string };
  fallbackImageUrl: string;
  sheetCode: string;
}) {
  const updateVariant = useUpdateColorVariant();
  const [uploading, setUploading] = useState(false);
  const [recoloring, setRecoloring] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const currentImage = variant.image_url || null;
  const hasFallback = !!fallbackImageUrl;

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Somente arquivos de imagem são aceitos');
      return;
    }
    setUploading(true);
    try {
      const url = await uploadVariantImage(file, variant.id);
      await updateVariant.mutateAsync({ id: variant.id, data: { image_url: url } });
      toast.success(`Imagem da cor ${variant.color} atualizada`);
    } catch (e: any) {
      toast.error(e.message ?? 'Erro no upload');
    } finally {
      setUploading(false);
    }
  };

  const handleRecolor = async () => {
    if (!fallbackImageUrl) {
      toast.error('A ficha técnica não possui imagem base para recolorir');
      return;
    }
    setRecoloring(true);
    try {
      const url = await recolorImage(fallbackImageUrl, variant.color, sheetCode);
      await updateVariant.mutateAsync({ id: variant.id, data: { image_url: url } });
      toast.success(`Imagem recolorida para ${variant.color}`);
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao recolorir');
    } finally {
      setRecoloring(false);
    }
  };

  const busy = uploading || recoloring;

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-lg border bg-card overflow-hidden transition-shadow',
        dragOver && 'ring-2 ring-primary shadow-lg',
      )}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
    >
      {/* Image area */}
      <div className="relative aspect-square bg-muted/30 flex items-center justify-center overflow-hidden">
        {currentImage ? (
          <SignedImage
            src={currentImage}
            alt={variant.color}
            className="w-full h-full object-cover"
          />
        ) : hasFallback ? (
          <div className="relative w-full h-full">
            <SignedImage
              src={fallbackImageUrl}
              alt={`${variant.color} (padrão)`}
              className="w-full h-full object-cover opacity-40"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
              <ImageOff className="h-5 w-5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground font-medium">sem imagem</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImageOff className="h-8 w-8" />
            <span className="text-xs">sem imagem</span>
          </div>
        )}

        {/* has own image badge */}
        {currentImage && (
          <span className="absolute top-1.5 right-1.5">
            <CheckCircle2 className="h-4 w-4 text-green-500 drop-shadow" />
          </span>
        )}

        {/* busy overlay */}
        {busy && (
          <div className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs font-medium">{recoloring ? 'Recolorindo…' : 'Enviando…'}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 space-y-2">
        <div className="flex items-center gap-1.5">
          <ColorSwatch hex={variant.hex_code} />
          <span className="text-xs font-semibold truncate flex-1">{variant.color}</span>
        </div>

        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 text-[11px] gap-1"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-3 w-3" />
            Upload
          </Button>

          {hasFallback && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-7 text-[11px] gap-1"
              disabled={busy}
              onClick={handleRecolor}
              title="Gerar imagem com IA na cor selecionada"
            >
              <Wand2 className="h-3 w-3" />
              IA
            </Button>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ─── Right panel: variants grid ───────────────────────────────────────────────
function VariantsPanel({ sheetId, sheetCode, sheetImageUrl }: {
  sheetId: string;
  sheetCode: string;
  sheetImageUrl: string;
}) {
  const { data: variants = [], isLoading } = useColorVariants(sheetId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando cores…
      </div>
    );
  }

  if (variants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
        <Palette className="h-8 w-8" />
        <p className="text-sm">Nenhuma variante de cor cadastrada para esta ficha.</p>
        <p className="text-xs">Cadastre cores na aba "Cores e Variantes" da Ficha Técnica.</p>
      </div>
    );
  }

  const withImage = variants.filter((v) => v.image_url).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="text-sm text-muted-foreground">
          {variants.length} cor{variants.length !== 1 ? 'es' : ''} cadastrada{variants.length !== 1 ? 's' : ''}
        </div>
        <Badge variant={withImage === variants.length ? 'default' : 'secondary'}>
          {withImage}/{variants.length} com imagem própria
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {variants.map((v) => (
          <VariantCard
            key={v.id}
            variant={v}
            fallbackImageUrl={sheetImageUrl}
            sheetCode={sheetCode}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ColorImagesPage() {
  const { data: sheets = [], isLoading } = useTechnicalSheets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = sheets.filter((s: any) => {
    const q = search.toLowerCase();
    return (
      (s.code ?? '').toLowerCase().includes(q) ||
      (s.name ?? '').toLowerCase().includes(q)
    );
  });

  const selected = sheets.find((s: any) => s.id === selectedId) as any;

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
        {/* ── Left: sheet list ─────────────────────────────── */}
        <aside className="w-64 shrink-0 border-r flex flex-col bg-card">
          <div className="p-3 border-b space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" />
              Imagens por Cor
            </h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar referência…"
                className="pl-8 h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center p-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4 text-center">Nenhuma ficha encontrada</p>
            ) : (
              filtered.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={cn(
                    'w-full text-left flex items-center gap-2 px-3 py-2 text-xs border-b border-border/40 transition-colors',
                    selectedId === s.id
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'hover:bg-muted/40 text-foreground',
                  )}
                >
                  {s.images?.[0] ? (
                    <SignedImage
                      src={s.images[0]}
                      alt={s.code}
                      className="h-8 w-8 rounded object-cover shrink-0 border border-border/60"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0">
                      <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{s.code}</div>
                    {s.name && <div className="text-muted-foreground truncate">{s.name}</div>}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* ── Right: color grid ────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-5">
          {!selectedId ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Palette className="h-12 w-12 opacity-30" />
              <p className="text-sm">Selecione uma referência na lista para gerenciar as imagens por cor.</p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-3">
                <div>
                  <h1 className="text-lg font-bold">{selected?.code}</h1>
                  {selected?.name && (
                    <p className="text-sm text-muted-foreground">{selected.name}</p>
                  )}
                </div>
                {selected?.images?.[0] && (
                  <SignedImage
                    src={selected.images[0]}
                    alt={selected.code}
                    className="h-14 w-14 rounded-lg object-cover border border-border shadow-sm"
                  />
                )}
              </div>

              <p className="text-xs text-muted-foreground mb-4">
                Faça upload ou gere com IA a imagem específica de cada cor.
                Cores <span className="text-green-600 font-medium">sem imagem própria</span> mostrarão a imagem padrão da ficha nos pedidos e relatórios.
              </p>

              <VariantsPanel
                sheetId={selectedId}
                sheetCode={selected?.code ?? ''}
                sheetImageUrl={selected?.images?.[0] ?? selected?.image_url ?? ''}
              />
            </>
          )}
        </main>
      </div>
    </AppLayout>
  );
}
