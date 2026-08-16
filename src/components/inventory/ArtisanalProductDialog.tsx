import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { ArtisanalStrapEditor } from '@/components/artisanal-straps/ArtisanalStrapEditor';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useArtisanalStrapCatalog } from '@/hooks/useArtisanalStraps';
import { normalizeStrapColorKey } from '@/lib/strapSourcing';
import type { Product } from '@/types/inventory';

interface Props {
  product?: Product | null;
  products?: Product[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Entrada do Estoque para o editor único de tiras artesanais. O formulário
 * antigo gravava `products.is_artisanal` e `artisanal_recipes` separadamente;
 * agora toda alteração passa pelo bundle transacional do catálogo canônico.
 */
export function ArtisanalProductDialog({ product, products, open, onOpenChange }: Props) {
  const catalogQuery = useArtisanalStrapCatalog(false);
  const target = products?.[0] || product || null;

  if (!target) return null;

  if (!catalogQuery.data) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Cadastro canônico de tira</DialogTitle></DialogHeader>
          {catalogQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Não foi possível abrir o cadastro</AlertTitle>
              <AlertDescription>
                {catalogQuery.error instanceof Error
                  ? catalogQuery.error.message
                  : 'Recarregue a página e tente novamente.'}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando catálogo…
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  const variant = catalogQuery.data.variants.find((item) =>
    item.finished_product_id === target.id);
  const contextualBaseGroupId = !variant && target.group_id
    && catalogQuery.data.official_products.some((official) =>
      official.base_group_id === target.group_id && official.status === 'active')
    ? target.group_id
    : null;
  const colorKey = normalizeStrapColorKey(target.color || '');
  const contextualColorIds = Array.from(new Set([
    ...catalogQuery.data.colors
      .filter((color) => normalizeStrapColorKey(color.name) === colorKey)
      .map((color) => color.id),
    ...catalogQuery.data.aliases
      .filter((alias) => alias.status === 'approved' && normalizeStrapColorKey(alias.alias) === colorKey)
      .map((alias) => alias.canonical_color_id),
  ]));
  const needsReview = !variant
    && (!contextualBaseGroupId || contextualColorIds.length !== 1);

  return (
    <ArtisanalStrapEditor
      open={open}
      onOpenChange={onOpenChange}
      catalog={catalogQuery.data}
      capabilities={catalogQuery.data.capabilities}
      mode={variant ? 'edit' : needsReview ? 'review' : 'create'}
      origin="estoque"
      variantId={variant?.id}
      baseGroupId={variant?.base_group_id || contextualBaseGroupId}
      colorId={variant?.color_id || (contextualColorIds.length === 1 ? contextualColorIds[0] : null)}
      onSaved={() => onOpenChange(false)}
    />
  );
}
