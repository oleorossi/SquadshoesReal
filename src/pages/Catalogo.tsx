import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CircleNotch as Loader2, Images, Sparkle as Sparkles, Trash, UploadSimple,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { cn } from '@/lib/utils';
import { CatalogColorPicker } from '@/components/catalog/CatalogColorPicker';
import { CatalogSheetBuilder } from '@/components/catalog/CatalogSheetBuilder';
import { CatalogColor, useCatalogColors } from '@/hooks/useCatalogColors';
import {
  CatalogPhoto, uploadRawCatalogPhoto, useCatalogPhotos,
  useDeleteCatalogPhoto, useGenerateCatalogPhoto,
} from '@/hooks/useCatalogPhotos';

interface RawUpload {
  url: string;
  name: string;
}

/**
 * Catálogo — foto crua do produto → foto de estúdio por IA em cada cor da
 * cartela → lâmina de catálogo montada no navegador (canvas, sem custo).
 * Geração de imagem restrita a admin/gerente (validado na Edge Function).
 */
export default function Catalogo() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<RawUpload[]>([]);
  const [activeUploadUrl, setActiveUploadUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [referenceId, setReferenceId] = useState('');
  const [selectedColors, setSelectedColors] = useState<Map<string, CatalogColor>>(new Map());
  const [extraInstructions, setExtraInstructions] = useState('');
  const [progress, setProgress] = useState<string | null>(null);

  const [sheetSelection, setSheetSelection] = useState<string[]>([]);

  const { data: colors = [] } = useCatalogColors();
  const { data: photos = [], isLoading: photosLoading } = useCatalogPhotos();
  const generatePhoto = useGenerateCatalogPhoto();
  const deletePhoto = useDeleteCatalogPhoto();

  const { data: references = [] } = useQuery({
    queryKey: ['technical_sheets_for_catalog'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, code, name')
        .order('code');
      if (error) throw error;
      return (data || []) as Array<{ id: string; code: string; name: string }>;
    },
    staleTime: 5 * 60_000,
  });

  const selectedReference = useMemo(
    () => references.find((r) => r.id === referenceId) || null,
    [references, referenceId],
  );

  const referenceOptions = useMemo(
    () => references.map((r) => ({ value: r.id, label: r.code || r.name, description: r.name })),
    [references],
  );

  const sheetPhotos = useMemo(() => {
    const byId = new Map(photos.map((p) => [p.id, p]));
    return sheetSelection.map((id) => byId.get(id)).filter(Boolean) as CatalogPhoto[];
  }, [photos, sheetSelection]);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const url = await uploadRawCatalogPhoto(file);
        setUploads((prev) => [...prev, { url, name: file.name }]);
        setActiveUploadUrl(url);
      }
      toast.success('Foto(s) enviada(s)!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleColor = (color: CatalogColor) => {
    setSelectedColors((prev) => {
      const next = new Map(prev);
      if (next.has(color.id)) next.delete(color.id);
      else next.set(color.id, color);
      return next;
    });
  };

  const toggleSheetPhoto = (photo: CatalogPhoto) => {
    setSheetSelection((prev) =>
      prev.includes(photo.id) ? prev.filter((id) => id !== photo.id) : [...prev, photo.id],
    );
  };

  const handleGenerate = async () => {
    if (!activeUploadUrl) {
      toast.error('Envie e selecione uma foto crua primeiro.');
      return;
    }
    if (selectedColors.size === 0) {
      toast.error('Selecione pelo menos uma cor da cartela.');
      return;
    }
    const colorsToRun = [...selectedColors.values()];
    let ok = 0;
    for (let i = 0; i < colorsToRun.length; i++) {
      const color = colorsToRun[i];
      setProgress(`Gerando ${color.nome}… (${i + 1}/${colorsToRun.length}) — cada cor leva ~1 min`);
      try {
        await generatePhoto.mutateAsync({
          imageUrl: activeUploadUrl,
          colorName: color.nome,
          colorHex: color.hex,
          referenceId: referenceId || null,
          referenceCode: selectedReference?.code || null,
          extraInstructions,
        });
        ok++;
      } catch (err) {
        toast.error(`${color.nome}: ${err instanceof Error ? err.message : 'falha na geração'}`);
      }
    }
    setProgress(null);
    if (ok > 0) toast.success(`${ok} de ${colorsToRun.length} cor(es) gerada(s)!`);
  };

  return (
    <div className="space-y-6">
      <EditorialPageHeader
        sectionLabel="COMERCIAL · CATÁLOGO"
        title="Catálogo"
        description="Foto crua do produto → foto de estúdio por IA em cada cor da cartela → lâmina do catálogo pronta pra baixar. O solado e as peças metálicas são preservados; só a cor das tiras muda. Geração disponível pra admin/gerente."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide">1 · Foto crua do produto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            multiple
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading
                ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Enviando…</>
                : <><UploadSimple className="mr-1.5 h-4 w-4" /> Enviar foto(s)</>}
            </Button>
            <div className="w-64">
              <SearchableSelect
                value={referenceId}
                onChange={setReferenceId}
                options={referenceOptions}
                placeholder="Vincular a uma referência (opcional)"
                searchPlaceholder="Buscar referência…"
              />
            </div>
          </div>
          {uploads.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {uploads.map((upload) => (
                <button
                  key={upload.url}
                  type="button"
                  onClick={() => setActiveUploadUrl(upload.url)}
                  className={cn(
                    'w-28 overflow-hidden rounded-lg border-2 bg-card text-left transition-colors',
                    activeUploadUrl === upload.url
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-border hover:border-primary/50',
                  )}
                  title={upload.name}
                >
                  <img src={upload.url} alt={upload.name} className="h-20 w-full object-cover" />
                  <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground">{upload.name}</span>
                </button>
              ))}
            </div>
          )}
          {uploads.length > 0 && (
            <p className="text-xs text-muted-foreground">
              A foto destacada é a ativa — as cores serão geradas a partir dela.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide">2 · Cores da cartela</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CatalogColorPicker
            colors={colors}
            selectedIds={new Set(selectedColors.keys())}
            onToggle={toggleColor}
          />
          <div className="space-y-1.5">
            <Label htmlFor="extra-ia" className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Instruções extras pra IA (opcional)
            </Label>
            <Textarea
              id="extra-ia"
              value={extraInstructions}
              onChange={(e) => setExtraInstructions(e.target.value)}
              placeholder="ex.: manter o brilho acetinado do couro"
              className="min-h-[60px]"
              maxLength={1000}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide">3 · Gerar fotos por IA</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button onClick={handleGenerate} disabled={!!progress}>
              {progress
                ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Gerando…</>
                : <><Sparkles className="mr-1.5 h-4 w-4" /> Gerar {selectedColors.size || ''} cor{selectedColors.size === 1 ? '' : 'es'}</>}
            </Button>
            {progress && <span className="text-sm text-muted-foreground">{progress}</span>}
          </div>

          {photosLoading ? (
            <p className="text-sm text-muted-foreground">Carregando galeria…</p>
          ) : photos.length === 0 ? (
            <EmptyState
              icon={Images}
              size="sm"
              title="Nenhuma foto gerada ainda"
              description="Envie uma foto crua, selecione as cores e clique em Gerar."
            />
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Clique nas fotos pra escolher quais entram na lâmina — a ordem do clique é a ordem na página.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {photos.map((photo) => {
                  const orderIdx = sheetSelection.indexOf(photo.id);
                  return (
                    <div
                      key={photo.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleSheetPhoto(photo)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSheetPhoto(photo); }}
                      className={cn(
                        'group relative cursor-pointer overflow-hidden rounded-lg border-2 bg-card transition-colors',
                        orderIdx >= 0
                          ? 'border-primary ring-2 ring-primary/30'
                          : 'border-border hover:border-primary/50',
                      )}
                    >
                      <img
                        src={photo.image_url}
                        alt={photo.color_nome}
                        loading="lazy"
                        className="aspect-[3/2] w-full object-cover"
                      />
                      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                          {photo.color_hex && (
                            <span
                              className="h-3 w-3 shrink-0 rounded-full border border-border/60"
                              style={{ backgroundColor: photo.color_hex }}
                            />
                          )}
                          <span className="truncate">{photo.color_nome}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {photo.reference_code || ''}
                        </span>
                      </div>
                      {orderIdx >= 0 && (
                        <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                          {orderIdx + 1}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        className="absolute right-1.5 top-1.5 hidden h-7 w-7 p-0 group-hover:flex"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSheetSelection((prev) => prev.filter((id) => id !== photo.id));
                          deletePhoto.mutate(photo);
                        }}
                        title="Excluir foto"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide">4 · Montar lâmina do catálogo</CardTitle>
        </CardHeader>
        <CardContent>
          <CatalogSheetBuilder photos={sheetPhotos} defaultRef={selectedReference?.code || ''} />
        </CardContent>
      </Card>
    </div>
  );
}
