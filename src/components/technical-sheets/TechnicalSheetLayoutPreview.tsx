import { useMemo, useState } from 'react';
import { Eye, Footprints, GridFour, Package, Stack } from '@phosphor-icons/react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SignedImage } from '@/components/ui/signed-image';
import { cn } from '@/lib/utils';

interface TechnicalSheetPreviewItem {
  id: string;
  name: string;
  code?: string | null;
  collection?: string | null;
  shoe_category?: string | null;
  status_ficha?: string | null;
  sole_material?: string | null;
  upper_material?: string | null;
  images?: unknown[] | null;
}

interface TechnicalSheetLayoutPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheets: TechnicalSheetPreviewItem[];
}

interface PreviewOption {
  id: 1 | 2 | 3 | 4 | 5;
  name: string;
  description: string;
  emphasis: string;
}

const PREVIEW_OPTIONS: PreviewOption[] = [
  {
    id: 1,
    name: 'Galeria técnica',
    description: 'Foto grande, nome e dados essenciais.',
    emphasis: 'Equilíbrio',
  },
  {
    id: 2,
    name: 'Álbum visual',
    description: 'Imagem dominante para reconhecer rápido.',
    emphasis: 'Foto',
  },
  {
    id: 3,
    name: 'Faixa compacta',
    description: 'Miniatura lateral e leitura mais densa.',
    emphasis: 'Volume',
  },
  {
    id: 4,
    name: 'Catálogo editorial',
    description: 'Numeração forte e composição de coleção.',
    emphasis: 'Identidade',
  },
  {
    id: 5,
    name: 'Prancheta fabril',
    description: 'Foto acompanhada dos dados operacionais.',
    emphasis: 'Informação',
  },
];

const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho',
  em_revisao: 'Em revisão',
  validada: 'Validada',
  publicada: 'Publicada',
};

function getImage(item: TechnicalSheetPreviewItem): string | null {
  if (!Array.isArray(item.images) || typeof item.images[0] !== 'string') return null;
  return item.images[0];
}

function PreviewImage({ item, className }: { item: TechnicalSheetPreviewItem; className?: string }) {
  const image = getImage(item);

  if (!image) {
    return (
      <div className={cn('flex items-center justify-center border bg-muted/40', className)}>
        <Package className="h-1/4 w-1/4 text-muted-foreground/35" weight="thin" />
      </div>
    );
  }

  return (
    <SignedImage
      src={image}
      alt={`Foto da referência ${item.name}`}
      className={cn('border bg-muted/30', className)}
    />
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  const resolved = status || 'rascunho';
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold',
        resolved === 'publicada' && 'border-success/30 bg-success/10 text-success',
        resolved === 'validada' && 'border-primary/20 bg-primary/10 text-primary',
        resolved === 'em_revisao' && 'border-warning/30 bg-warning/10 text-warning',
        resolved === 'rascunho' && 'border-border bg-muted text-muted-foreground',
      )}
    >
      {STATUS_LABELS[resolved] || resolved}
    </span>
  );
}

function LayoutMiniature({ option, selected }: { option: PreviewOption; selected: boolean }) {
  const blocks = [0, 1, 2, 3, 4];

  if (option.id === 3) {
    return (
      <div className="grid gap-1" aria-hidden="true">
        {blocks.slice(0, 3).map(block => (
          <div key={block} className="flex h-5 gap-1 border bg-background p-0.5">
            <div className={cn('w-5 bg-muted', selected && 'bg-primary/20')} />
            <div className="flex-1 space-y-1 py-0.5">
              <div className="h-1 w-4/5 bg-foreground/70" />
              <div className="h-1 w-1/2 bg-muted-foreground/25" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-5 gap-1" aria-hidden="true">
      {blocks.map(block => (
        <div key={block} className={cn('border bg-background p-0.5', option.id === 4 && 'border-0 border-t')}>
          <div
            className={cn(
              'bg-muted',
              option.id === 1 && 'aspect-[4/3]',
              option.id === 2 && 'aspect-square',
              option.id === 4 && 'aspect-[3/4]',
              option.id === 5 && 'aspect-[5/4]',
              selected && 'bg-primary/20',
            )}
          />
          <div className="mt-1 h-1 bg-foreground/60" />
          {option.id !== 2 && <div className="mt-0.5 h-1 w-2/3 bg-muted-foreground/20" />}
        </div>
      ))}
    </div>
  );
}

function LayoutSelector({ selected, onSelect }: { selected: number; onSelect: (id: number) => void }) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[920px] grid-cols-5 gap-2">
        {PREVIEW_OPTIONS.map(option => {
          const isSelected = selected === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(option.id)}
              className={cn(
                'group border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                isSelected
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-card hover:border-foreground/60 hover:bg-muted/40',
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="ed-mono text-[10px] font-semibold tracking-widest">0{option.id}</span>
                <span className={cn('text-[9px] font-semibold uppercase tracking-wider', isSelected ? 'text-background/70' : 'text-muted-foreground')}>
                  {option.emphasis}
                </span>
              </div>
              <div className={cn('rounded-sm p-1', isSelected ? 'bg-background text-foreground' : 'bg-muted/40')}>
                <LayoutMiniature option={option} selected={isSelected} />
              </div>
              <p className="mt-2 text-xs font-bold leading-tight">{option.name}</p>
              <p className={cn('mt-1 text-[10px] leading-snug', isSelected ? 'text-background/70' : 'text-muted-foreground')}>
                {option.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GalleryLayout({ items }: { items: TechnicalSheetPreviewItem[] }) {
  return (
    <div className="grid min-w-[900px] grid-cols-5 gap-3">
      {items.map(item => (
        <article key={item.id} className="overflow-hidden border bg-card">
          <PreviewImage item={item} className="aspect-[4/3] w-full border-0 border-b" />
          <div className="space-y-3 p-3">
            <div>
              <p className="truncate text-sm font-bold">{item.name}</p>
              <p className="ed-mono mt-1 truncate text-[10px] text-muted-foreground">{item.code || 'SEM CÓDIGO'}</p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <StatusBadge status={item.status_ficha} />
              <span className="truncate text-[10px] text-muted-foreground">{item.shoe_category || 'Geral'}</span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function AlbumLayout({ items }: { items: TechnicalSheetPreviewItem[] }) {
  return (
    <div className="grid min-w-[860px] grid-cols-5 gap-px border bg-border">
      {items.map(item => (
        <article key={item.id} className="bg-card p-2">
          <div className="relative">
            <PreviewImage item={item} className="aspect-square w-full border-0" />
            <span className="absolute left-2 top-2 bg-foreground px-1.5 py-1 text-[9px] font-bold uppercase tracking-wider text-background">
              {item.shoe_category || 'Geral'}
            </span>
          </div>
          <p className="mt-2 truncate text-sm font-bold">{item.name}</p>
          <p className="truncate text-[10px] text-muted-foreground">{item.collection || item.code || 'Sem coleção'}</p>
        </article>
      ))}
    </div>
  );
}

function CompactLayout({ items }: { items: TechnicalSheetPreviewItem[] }) {
  return (
    <div className="grid min-w-[1080px] grid-cols-5 gap-2">
      {items.map(item => (
        <article key={item.id} className="flex min-w-0 gap-2 border bg-card p-2">
          <PreviewImage item={item} className="h-20 w-20 shrink-0 rounded-sm" />
          <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
            <div>
              <p className="truncate text-xs font-bold">{item.name}</p>
              <p className="ed-mono mt-1 truncate text-[9px] text-muted-foreground">{item.code || 'SEM CÓDIGO'}</p>
            </div>
            <StatusBadge status={item.status_ficha} />
          </div>
        </article>
      ))}
    </div>
  );
}

function EditorialLayout({ items }: { items: TechnicalSheetPreviewItem[] }) {
  return (
    <div className="grid min-w-[900px] grid-cols-5 gap-4 border-y-2 border-foreground py-3">
      {items.map((item, index) => (
        <article key={item.id} className="grid grid-cols-[2.5rem_1fr] gap-2 border-r pr-3 last:border-r-0">
          <span className="ed-display text-3xl leading-none text-primary">0{index + 1}</span>
          <div className="min-w-0">
            <PreviewImage item={item} className="aspect-[3/4] w-full border-foreground" />
            <p className="mt-2 truncate text-xs font-bold uppercase tracking-wide">{item.name}</p>
            <p className="ed-mono mt-1 truncate text-[9px] text-muted-foreground">{item.code || 'SEM CÓDIGO'}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function ClipboardLayout({ items }: { items: TechnicalSheetPreviewItem[] }) {
  return (
    <div className="grid min-w-[1050px] grid-cols-5 gap-3">
      {items.map(item => (
        <article key={item.id} className="border-2 border-foreground bg-card">
          <div className="flex items-center justify-between border-b border-foreground px-2 py-1.5">
            <span className="ed-mono truncate text-[9px] font-bold">{item.code || 'SEM CÓDIGO'}</span>
            <StatusBadge status={item.status_ficha} />
          </div>
          <PreviewImage item={item} className="aspect-[5/4] w-full border-0 border-b border-foreground" />
          <div className="space-y-2 p-2.5">
            <p className="truncate text-sm font-bold">{item.name}</p>
            <div className="grid gap-1 text-[10px] text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1">
                <Footprints className="h-3 w-3 shrink-0" />
                <span className="truncate">{item.sole_material || 'Solado não definido'}</span>
              </span>
              <span className="flex min-w-0 items-center gap-1">
                <Stack className="h-3 w-3 shrink-0" />
                <span className="truncate">{item.upper_material || 'Cabedal não definido'}</span>
              </span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function SelectedLayout({ selected, items }: { selected: number; items: TechnicalSheetPreviewItem[] }) {
  if (selected === 2) return <AlbumLayout items={items} />;
  if (selected === 3) return <CompactLayout items={items} />;
  if (selected === 4) return <EditorialLayout items={items} />;
  if (selected === 5) return <ClipboardLayout items={items} />;
  return <GalleryLayout items={items} />;
}

export function TechnicalSheetLayoutPreview({ open, onOpenChange, sheets }: TechnicalSheetLayoutPreviewProps) {
  const [selected, setSelected] = useState<number>(1);
  const selectedOption = PREVIEW_OPTIONS.find(option => option.id === selected) || PREVIEW_OPTIONS[0];
  const previewItems = useMemo(() => {
    return [...sheets]
      .sort((a, b) => Number(Boolean(getImage(b))) - Number(Boolean(getImage(a))))
      .slice(0, 5);
  }, [sheets]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[1440px] gap-0 overflow-hidden p-0 sm:w-[96vw]">
        <DialogHeader className="border-b p-4 pr-12 text-left sm:p-6 sm:pr-14">
          <div className="mb-1 flex items-center gap-2 text-primary">
            <GridFour className="h-4 w-4" weight="bold" />
            <span className="ed-mono text-[10px] font-bold uppercase tracking-[0.18em]">Preview · cinco opções</span>
          </div>
          <DialogTitle>Escolha o formato do catálogo</DialogTitle>
          <DialogDescription>
            As cinco opções usam as mesmas fichas e fotos reais. Clique numa miniatura para comparar; a listagem atual ainda não será alterada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
          <LayoutSelector selected={selected} onSelect={setSelected} />

          <section aria-live="polite" aria-label={`Preview da opção ${selected}: ${selectedOption.name}`} className="border bg-muted/20">
            <div className="flex flex-col gap-2 border-b bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="ed-mono text-[10px] font-bold uppercase tracking-widest text-primary">Opção 0{selected}</p>
                <h3 className="text-base font-bold">{selectedOption.name}</h3>
              </div>
              <p className="max-w-xl text-xs text-muted-foreground sm:text-right">{selectedOption.description}</p>
            </div>

            <div className="overflow-x-auto p-4 sm:p-5">
              {previewItems.length > 0 ? (
                <SelectedLayout selected={selected} items={previewItems} />
              ) : (
                <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <Package className="h-8 w-8" weight="thin" />
                  <p className="text-sm font-medium">Nenhuma ficha disponível para montar a amostra.</p>
                </div>
              )}
            </div>
          </section>

          <div className="flex flex-col gap-2 border-l-2 border-primary bg-primary/5 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2 font-semibold">
              <Eye className="h-4 w-4 text-primary" />
              Você está comparando a opção 0{selected}.
            </span>
            <span className="text-muted-foreground">Informe o número escolhido para aplicarmos como visualização definitiva.</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
