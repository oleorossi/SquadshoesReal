import { useEffect, useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type ArtisanalStrapCatalog,
  type ArtisanalStrapCatalogDiagnostic,
  type ArtisanalStrapLegacyMigrationDiagnostic,
  type ArtisanalStrapSourceMode,
  useResolveArtisanalStrapMigrationReviewItem,
  useResolveLegacyArtisanalStrapRecipeMigration,
} from '@/hooks/useArtisanalStraps';

function recipeLabel(catalog: ArtisanalStrapCatalog, recipeId: string) {
  const recipe = catalog.recipes.find((item) => item.id === recipeId);
  if (!recipe) return recipeId;
  const measure = catalog.measures.find((item) => item.id === recipe.measure_id);
  const type = catalog.types.find((item) => item.id === measure?.strap_type_id);
  const base = catalog.groups.find((item) => item.id === recipe.base_group_id);
  return [type?.name, measure?.display_name, base?.name, `v${recipe.version}`, recipe.status].filter(Boolean).join(' · ');
}

export function ArtisanalStrapMigrationResolutionDialog({
  diagnostic,
  catalog,
  onClose,
}: {
  diagnostic: ArtisanalStrapCatalogDiagnostic | ArtisanalStrapLegacyMigrationDiagnostic | null;
  catalog: ArtisanalStrapCatalog;
  onClose: () => void;
}) {
  const resolveRecipe = useResolveLegacyArtisanalStrapRecipeMigration();
  const resolveReview = useResolveArtisanalStrapMigrationReviewItem();
  const [recipeId, setRecipeId] = useState('');
  const [floorMode, setFloorMode] = useState<ArtisanalStrapSourceMode | ''>('');
  const [reason, setReason] = useState('');
  const close = () => {
    setRecipeId(''); setFloorMode(''); setReason(''); onClose();
  };
  useEffect(() => {
    setRecipeId('');
    setFloorMode('');
    setReason('');
  }, [diagnostic?.issue_code, diagnostic?.entity_id]);

  const details = (diagnostic?.details || {}) as Record<string, unknown>;
  const isRecipe = diagnostic?.issue_code === 'legacy_recipe_map_review_required';
  const entityType = diagnostic?.issue_code === 'legacy_replenishment_source_unavailable'
    ? 'legacy_replenishment_source_unavailable'
    : String(details.entity_type || '');
  const allowedFloorReview = ['legacy_replenishment_mode', 'legacy_replenishment_source_unavailable'].includes(entityType);
  const isReview = allowedFloorReview && (
    diagnostic?.issue_code === 'migration_review_item_required'
    || diagnostic?.issue_code === 'legacy_replenishment_source_unavailable'
  );
  const candidates = details.candidates && typeof details.candidates === 'object'
    ? details.candidates as Record<string, unknown>
    : details.resolution_payload && typeof details.resolution_payload === 'object'
      ? details.resolution_payload as Record<string, unknown>
      : {};
  const legacyVariantId = String(details.strap_variant_id || details.legacy_id || '');
  const candidateVariantId = String(candidates.strap_variant_id || '');
  const variantId = legacyVariantId || candidateVariantId;
  const variantIdentityConflict = Boolean(
    legacyVariantId && candidateVariantId && legacyVariantId !== candidateVariantId,
  );
  const variant = catalog.variants.find((item) => item.id === variantId);
  const measure = catalog.measures.find((item) => item.id === variant?.measure_id);
  const type = catalog.types.find((item) => item.id === measure?.strap_type_id);
  const base = catalog.groups.find((item) => item.id === variant?.base_group_id);
  const color = catalog.colors.find((item) => item.id === variant?.color_id);
  const product = catalog.products.find((item) => item.id === variant?.finished_product_id);
  const variantText = variant
    ? [type?.name, measure?.display_name, base?.name, color?.name, product?.name].filter(Boolean).join(' · ')
    : variantId;
  const reviewItemId = String(details.review_item_id || diagnostic?.entity_id || '');
  const candidateText = Object.keys(candidates).length > 0
    ? JSON.stringify(candidates, null, 2)
    : null;

  return (
    <Dialog open={!!diagnostic && (isRecipe || isReview)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isRecipe ? 'Vincular receita legada' : 'Confirmar origem do estoque mínimo'}</DialogTitle>
          <DialogDescription>
            Nenhum nome será inferido. A decisão fica registrada com UUIDs canônicos e motivo.
          </DialogDescription>
        </DialogHeader>
        {isRecipe ? (
          <div className="space-y-1.5">
            <Label>Receita canônica *</Label>
            <Select value={recipeId} onValueChange={setRecipeId}>
              <SelectTrigger><SelectValue placeholder="Selecione a versão exata" /></SelectTrigger>
              <SelectContent>{catalog.recipes.map((recipe) => <SelectItem key={recipe.id} value={recipe.id}>{recipeLabel(catalog, recipe.id)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Tipo legado: <strong className="text-foreground">{entityType}</strong></p>
            <div className="space-y-1.5">
              <Label>Variante canônica do diagnóstico</Label>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-sm font-semibold">{variantText || 'Identidade ausente'}</p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{variantId || 'sem UUID'}</p>
              </div>
              <p className="text-xs text-muted-foreground">Somente leitura: para trocar a variante, use o resolvedor concreto do cadastro ou documento de origem.</p>
            </div>
            {(variantIdentityConflict || !variant) && (
              <Alert variant="destructive"><Warning className="h-4 w-4" /><AlertTitle>Identidade exata indisponível</AlertTitle><AlertDescription>{variantIdentityConflict ? 'O UUID legado diverge do candidato retornado. Recarregue o diagnóstico; nenhuma resolução será enviada.' : 'A variante indicada pela revisão não existe no catálogo carregado. Recarregue antes de decidir.'}</AlertDescription></Alert>
            )}
            <div className="space-y-1.5"><Label>Origem do piso *</Label><Select value={floorMode} onValueChange={(value) => setFloorMode(value as ArtisanalStrapSourceMode)}><SelectTrigger><SelectValue placeholder="Confirme explicitamente" /></SelectTrigger><SelectContent><SelectItem value="internal">Produzir com napa própria</SelectItem><SelectItem value="buy_ready">Comprar tira pronta</SelectItem></SelectContent></Select></div>
            {candidateText && <pre className="max-h-36 overflow-auto rounded-md border bg-muted/30 p-2 text-[10px] text-muted-foreground">{candidateText}</pre>}
          </div>
        )}
        <div className="space-y-1.5"><Label>Motivo *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancelar</Button>
          <Button
            disabled={!diagnostic || !reason.trim() || (isRecipe ? !recipeId : !floorMode || !variant || variantIdentityConflict || !reviewItemId) || resolveRecipe.isPending || resolveReview.isPending}
            onClick={async () => {
              if (!diagnostic) return;
              if (isRecipe) {
                await resolveRecipe.mutateAsync({
                  legacyRecipeId: String(details.legacy_recipe_id || diagnostic.entity_id),
                  canonicalRecipeId: recipeId,
                  reason: reason.trim(),
                });
              } else {
                await resolveReview.mutateAsync({
                  reviewItemId,
                  resolution: {
                    strap_variant_id: variantId,
                    min_stock_replenishment_mode: floorMode,
                  },
                  reason: reason.trim(),
                });
              }
              close();
            }}
          >Registrar resolução</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
