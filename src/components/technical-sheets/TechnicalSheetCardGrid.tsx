import { Footprints, ImageSquare as ImagePlus, Package, Stack as Layers, Trash } from '@phosphor-icons/react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SignedImage } from '@/components/ui/signed-image';
import { cn } from '@/lib/utils';

export interface TechnicalSheetGridItem {
  id: string;
  name: string;
  code?: string | null;
  collection?: string | null;
  shoe_category?: string | null;
  status_ficha?: string | null;
  sole_material?: string | null;
  upper_material?: string | null;
  images?: unknown;
}

interface MaterialVariantSummary {
  material_name: string;
}

interface Props {
  sheets: TechnicalSheetGridItem[];
  materialVariantsBySheet?: ReadonlyMap<string, readonly MaterialVariantSummary[]>;
  canDelete: boolean;
  onOpenSheet: (id: string) => void;
  onEditImage: (sheet: TechnicalSheetGridItem) => void;
  onDeleteSheet: (sheet: TechnicalSheetGridItem) => void;
}

const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho',
  em_revisao: 'Em revisão',
  validada: 'Validada',
  publicada: 'Publicada',
  arquivada: 'Arquivada',
};

const STATUS_STYLES: Record<string, string> = {
  publicada: 'border-success/30 bg-success/10 text-success',
  validada: 'border-primary/20 bg-primary/10 text-primary',
  em_revisao: 'border-warning/30 bg-warning/10 text-warning',
  rascunho: 'border-border bg-muted text-muted-foreground',
  arquivada: 'border-border bg-muted text-muted-foreground',
};

function getImage(sheet: TechnicalSheetGridItem): string | null {
  if (!Array.isArray(sheet.images) || typeof sheet.images[0] !== 'string') return null;
  return sheet.images[0];
}

function SheetThumbnail({ sheet }: { sheet: TechnicalSheetGridItem }) {
  const image = getImage(sheet);

  if (!image) {
    return (
      <div
        className="flex aspect-video w-full items-center justify-center bg-muted/40"
        role="img"
        aria-label={`Sem imagem para ${sheet.name}`}
      >
        <Package className="h-7 w-7 text-muted-foreground/30" weight="thin" />
      </div>
    );
  }

  return (
    <SignedImage
      src={image}
      alt={`Foto da referência ${sheet.name}`}
      className="aspect-video w-full border-0 bg-muted/20 transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none"
      fit="contain"
    />
  );
}

export function TechnicalSheetCardGrid({
  sheets,
  materialVariantsBySheet,
  canDelete,
  onOpenSheet,
  onEditImage,
  onDeleteSheet,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5 min-[1800px]:grid-cols-6">
      {sheets.map(sheet => {
        const status = sheet.status_ficha || 'rascunho';
        const variants = materialVariantsBySheet?.get(sheet.id) || [];

        return (
          <article
            key={sheet.id}
            className="group flex min-w-0 flex-col overflow-hidden border-2 border-foreground bg-card transition-colors hover:bg-muted/20"
          >
            <button
              type="button"
              className="flex w-full flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => onOpenSheet(sheet.id)}
              aria-label={`Abrir ficha técnica ${sheet.name}`}
            >
              <div className="flex min-w-0 items-center justify-between gap-1 border-b border-foreground px-2 py-1.5">
                <span className="min-w-0 truncate text-xs font-bold sm:text-sm" title={sheet.name}>
                  {sheet.name}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none sm:px-2 sm:text-[10px]',
                    STATUS_STYLES[status] || STATUS_STYLES.rascunho,
                  )}
                >
                  {STATUS_LABELS[status] || status}
                </span>
              </div>

              <div className="overflow-hidden border-b border-foreground">
                <SheetThumbnail sheet={sheet} />
              </div>

              <div className="flex flex-1 flex-col space-y-1.5 p-2 sm:p-2.5">
                <div className="min-h-8">
                  {sheet.code && (
                    <p className="truncate font-mono text-[9px] text-muted-foreground sm:text-[10px]" title={`Código interno: ${sheet.code}`}>
                      Cód. interno: {sheet.code}
                    </p>
                  )}
                  {sheet.collection && (
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground sm:text-xs" title={sheet.collection}>
                      {sheet.collection}
                    </p>
                  )}
                </div>

                <div className="mt-auto grid gap-1 text-[9px] text-muted-foreground sm:text-[10px]">
                  <span className="flex min-w-0 items-center gap-1" title={sheet.sole_material || 'Solado não definido'}>
                    <Footprints className="h-3 w-3 shrink-0" />
                    <span className="truncate">{sheet.sole_material || 'Solado não definido'}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-1" title={sheet.upper_material || 'Cabedal não definido'}>
                    <Layers className="h-3 w-3 shrink-0" />
                    <span className="truncate">{sheet.upper_material || 'Cabedal não definido'}</span>
                  </span>
                  {variants.length > 0 && (
                    <span className="flex min-w-0 items-center gap-1 text-warning" title={variants.map(variant => variant.material_name).join(', ')}>
                      <Package className="h-3 w-3 shrink-0" />
                      <span className="truncate">{variants.length} {variants.length === 1 ? 'material alternativo' : 'materiais alternativos'}</span>
                    </span>
                  )}
                </div>
              </div>
            </button>

            <div className="flex min-w-0 items-center justify-between gap-1 border-t border-foreground px-1.5 py-1 sm:px-2 sm:py-1.5">
              <Badge variant="outline" className="min-w-0 flex-1 truncate rounded-sm px-1.5 py-0 text-[10px] uppercase tracking-wider">
                {sheet.shoe_category || 'Geral'}
              </Badge>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 sm:h-8 sm:w-8"
                  aria-label={`Alterar foto de ${sheet.name}`}
                  title={`Alterar foto de ${sheet.name}`}
                  onClick={() => onEditImage(sheet)}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                </Button>
                {canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 text-destructive hover:text-destructive sm:h-8 sm:w-8"
                    aria-label={`Excluir ficha ${sheet.name}`}
                    title={`Excluir ficha ${sheet.name}`}
                    onClick={() => onDeleteSheet(sheet)}
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
