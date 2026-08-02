import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CircleNotch as Loader2, DownloadSimple, FilePng } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { buildCatalogSheets } from '@/lib/catalogSheet';
import { CatalogPhoto } from '@/hooks/useCatalogPhotos';

interface Props {
  /** Fotos na ordem em que devem entrar na lâmina. */
  photos: CatalogPhoto[];
  /** Ref. sugerida (da referência selecionada na página). */
  defaultRef?: string;
}

interface PageResult {
  url: string;
  filename: string;
}

/**
 * Monta a(s) lâmina(s) do catálogo no navegador (canvas — sem custo de IA):
 * campos editáveis + prévia + download PNG por página.
 */
export function CatalogSheetBuilder({ photos, defaultRef }: Props) {
  const [brand, setBrand] = useState('Squad Shoes');
  const [collectionLabel, setCollectionLabel] = useState('COLEÇÃO');
  const [collectionYear, setCollectionYear] = useState(String(new Date().getFullYear()));
  const [ref, setRef] = useState(defaultRef || '');
  const [sizes, setSizes] = useState('numeração 34 ao 40');
  const [perPage, setPerPage] = useState('3');
  const [bandColor, setBandColor] = useState('#C44A5F');
  const [building, setBuilding] = useState(false);
  const [pages, setPages] = useState<PageResult[]>([]);

  useEffect(() => {
    if (defaultRef) setRef(defaultRef);
  }, [defaultRef]);

  // Revoga object URLs antigas quando trocam ou no unmount.
  useEffect(() => {
    return () => pages.forEach((p) => URL.revokeObjectURL(p.url));
  }, [pages]);

  const handleBuild = async () => {
    if (!photos.length) {
      toast.error('Selecione as fotos geradas que entram na lâmina.');
      return;
    }
    setBuilding(true);
    try {
      const blobs = await buildCatalogSheets({
        brand,
        collectionLabel,
        collectionYear,
        ref,
        sizes,
        perPage: parseInt(perPage, 10),
        bandColor,
        items: photos.map((p) => ({ imageUrl: p.image_url, label: p.color_nome })),
      });
      setPages(
        blobs.map((blob, i) => ({
          url: URL.createObjectURL(blob),
          filename: `catalogo_${ref || 'sem-ref'}_p${i + 1}.png`,
        })),
      );
      toast.success(`${blobs.length} página(s) montada(s)!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao montar a lâmina.');
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Marca</Label>
          <Input value={brand} onChange={(e) => setBrand(e.target.value)} className="h-8 w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Faixa lateral</Label>
          <Input value={collectionLabel} onChange={(e) => setCollectionLabel(e.target.value)} className="h-8 w-32" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Ano</Label>
          <Input value={collectionYear} onChange={(e) => setCollectionYear(e.target.value)} className="h-8 w-20" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Ref.</Label>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="552121" className="h-8 w-28" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Numeração</Label>
          <Input value={sizes} onChange={(e) => setSizes(e.target.value)} className="h-8 w-44" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Cores por página</Label>
          <Select value={perPage} onValueChange={setPerPage}>
            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['1', '2', '3', '4', '5', '6'].map((n) => (
                <SelectItem key={n} value={n}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Cor da faixa</Label>
          <input
            type="color"
            aria-label="Cor da faixa lateral"
            value={bandColor}
            onChange={(e) => setBandColor(e.target.value.toUpperCase())}
            className="h-8 w-12 cursor-pointer rounded-md border border-border bg-card p-0.5"
          />
        </div>
        <Button size="sm" onClick={handleBuild} disabled={building || !photos.length}>
          {building
            ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Montando…</>
            : <><FilePng className="mr-1.5 h-4 w-4" /> Montar lâmina ({photos.length} foto{photos.length === 1 ? '' : 's'})</>}
        </Button>
      </div>

      {pages.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {pages.map((page) => (
            <div key={page.url} className="w-[340px] overflow-hidden rounded-lg border border-border bg-card">
              <img src={page.url} alt={page.filename} className="block w-full" />
              <div className="flex items-center justify-between px-3 py-2">
                <span className="truncate text-xs text-muted-foreground">{page.filename}</span>
                <Button asChild size="sm" variant="outline" className="h-7">
                  <a href={page.url} download={page.filename}>
                    <DownloadSimple className="mr-1 h-3.5 w-3.5" /> Baixar
                  </a>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
