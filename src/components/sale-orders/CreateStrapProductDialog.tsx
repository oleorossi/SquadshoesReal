import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import {
  ArtisanalStrapEditor,
  type ArtisanalStrapEditorOrigin,
} from '@/components/artisanal-straps/ArtisanalStrapEditor';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useArtisanalStrapCatalog } from '@/hooks/useArtisanalStraps';
import { normalizeStrapColorKey } from '@/lib/strapSourcing';
import { isUuid } from '@/lib/technicalStrapLines';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mantidos para compatibilidade dos pontos de entrada legados. A identidade
   * operacional não é mais resolvida por nome/grupo; o editor exige UUIDs. */
  groupId: string;
  groupName: string;
  color: string;
  onCreated: (created?: { variantId: string; colorId: string }) => void;
  referenceId?: string | null;
  materialVariantId?: string | null;
  origin?: ArtisanalStrapEditorOrigin;
  measureId?: string | null;
  variantId?: string | null;
}

/**
 * Adaptador dos antigos botões “criar tira”. Todos eles agora abrem o mesmo
 * editor atômico do hub; este componente não grava produto nem receita.
 */
export default function CreateStrapProductDialog({
  open,
  onOpenChange,
  onCreated,
  referenceId,
  materialVariantId,
  origin,
  groupId,
  color,
  measureId,
  variantId,
}: Props) {
  const catalogQuery = useArtisanalStrapCatalog(false);

  if (!catalogQuery.data) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cadastro canônico de tira</DialogTitle>
          </DialogHeader>
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

  const catalog = catalogQuery.data;
  const colorKey = normalizeStrapColorKey(color);
  const exactColorIds = catalog.colors
    .filter((entry) => normalizeStrapColorKey(entry.name) === colorKey)
    .map((entry) => entry.id);
  const aliasColorIds = catalog.aliases
    .filter((entry) => entry.status === 'approved' && normalizeStrapColorKey(entry.alias) === colorKey)
    .map((entry) => entry.canonical_color_id);
  const resolvedColorIds = Array.from(new Set([...exactColorIds, ...aliasColorIds]));
  const contextualColorId = resolvedColorIds.length === 1 ? resolvedColorIds[0] : null;
  const contextualBaseGroupId = isUuid(groupId) && catalog.official_products.some((entry) =>
    entry.base_group_id === groupId && entry.status === 'active')
    ? groupId
    : null;
  // No PV, `groupId` já vem do preview canônico que resolveu
  // referenceId+materialVariantId no servidor. Se esse snapshot não chegou,
  // os IDs de contexto apenas forçam revisão: este adapter nunca adivinha a
  // napa por nome nem consulta a variante legada como segunda fonte.
  const unresolvedMaterialContext = Boolean((referenceId || materialVariantId) && !contextualBaseGroupId);
  const needsReview = (Boolean(colorKey) && resolvedColorIds.length !== 1)
    || unresolvedMaterialContext
    || (Boolean(groupId) && !contextualBaseGroupId);
  const activateOnCreate = (origin === 'pv' || (!origin && Boolean(referenceId)))
    && !variantId
    && isUuid(measureId)
    && Boolean(contextualBaseGroupId)
    && Boolean(contextualColorId)
    && !needsReview;

  return (
    <ArtisanalStrapEditor
      open={open}
      onOpenChange={onOpenChange}
      catalog={catalog}
      capabilities={catalog.capabilities}
      mode={variantId ? 'edit' : needsReview ? 'review' : 'create'}
      origin={origin || (referenceId ? 'pv' : 'grupos')}
      variantId={variantId}
      measureId={measureId}
      baseGroupId={contextualBaseGroupId}
      colorId={contextualColorId}
      activateOnCreate={activateOnCreate}
      onSaved={(savedVariantId, _result, savedColorId) => onCreated({
        variantId: savedVariantId,
        colorId: savedColorId,
      })}
    />
  );
}
