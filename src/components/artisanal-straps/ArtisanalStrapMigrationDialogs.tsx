import { useState } from 'react';
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
  diagnostic: ArtisanalStrapCatalogDiagnostic | null;
  catalog: ArtisanalStrapCatalog;
  onClose: () => void;
}) {
  const resolveRecipe = useResolveLegacyArtisanalStrapRecipeMigration();
  const resolveReview = useResolveArtisanalStrapMigrationReviewItem();
  const [recipeId, setRecipeId] = useState('');
  const [baseGroupId, setBaseGroupId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [floorMode, setFloorMode] = useState<ArtisanalStrapSourceMode>('internal');
  const [reason, setReason] = useState('');
  const close = () => {
    setRecipeId(''); setBaseGroupId(''); setVariantId(''); setFloorMode('internal'); setReason(''); onClose();
  };
  const entityType = String(diagnostic?.details?.entity_type || 'item legado');
  const isRecipe = diagnostic?.issue_code === 'legacy_recipe_map_review_required';
  // Produto legado exige split conservativo do RPC 03300. Este diálogo nunca
  // pode reduzi-lo a um simples status resolved.
  const isReview = diagnostic?.issue_code === 'migration_review_item_required'
    && entityType !== 'legacy_product';
  const candidateText = diagnostic?.details?.candidates
    ? JSON.stringify(diagnostic.details.candidates, null, 2)
    : null;
  const variants = catalog.variants.filter((variant) => !baseGroupId || variant.base_group_id === baseGroupId);

  return (
    <Dialog open={!!diagnostic && (isRecipe || isReview)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isRecipe ? 'Vincular receita legada' : 'Resolver item legado'}</DialogTitle>
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
            <div className="space-y-1.5"><Label>Napa-base *</Label><Select value={baseGroupId} onValueChange={(value) => { setBaseGroupId(value); setVariantId(''); }}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{catalog.groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Variante canônica *</Label><Select value={variantId} onValueChange={setVariantId} disabled={!baseGroupId}><SelectTrigger><SelectValue placeholder="Selecione a identidade exata" /></SelectTrigger><SelectContent>{variants.map((variant) => { const measure = catalog.measures.find((item) => item.id === variant.measure_id); const color = catalog.colors.find((item) => item.id === variant.color_id); return <SelectItem key={variant.id} value={variant.id}>{measure?.display_name || variant.measure_id} · {color?.name || variant.color_id}</SelectItem>; })}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Origem do piso *</Label><Select value={floorMode} onValueChange={(value) => setFloorMode(value as ArtisanalStrapSourceMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="internal">Produzir com napa própria</SelectItem><SelectItem value="buy_ready">Comprar tira pronta</SelectItem></SelectContent></Select></div>
            {candidateText && <pre className="max-h-36 overflow-auto rounded-md border bg-muted/30 p-2 text-[10px] text-muted-foreground">{candidateText}</pre>}
          </div>
        )}
        <div className="space-y-1.5"><Label>Motivo *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancelar</Button>
          <Button
            disabled={!diagnostic || !reason.trim() || (isRecipe ? !recipeId : !baseGroupId || !variantId) || resolveRecipe.isPending || resolveReview.isPending}
            onClick={async () => {
              if (!diagnostic) return;
              if (isRecipe) {
                await resolveRecipe.mutateAsync({
                  legacyRecipeId: String(diagnostic.details.legacy_recipe_id || diagnostic.entity_id),
                  canonicalRecipeId: recipeId,
                  reason: reason.trim(),
                });
              } else {
                await resolveReview.mutateAsync({
                  reviewItemId: diagnostic.entity_id,
                  resolution: {
                    base_group_id: baseGroupId,
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
