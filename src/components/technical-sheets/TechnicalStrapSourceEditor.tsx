import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { applyTechnicalStrapIdentity, type TechnicalStrapLineLike } from '@/lib/technicalStrapLines';
import { strapIdentityBasis } from '@/lib/strapIdentity';
import { isTechnicalStrapSourceAllowed, technicalStrapSourcePolicy, type TechnicalStrapSourceCatalog } from '@/lib/technicalStrapSourcePolicy';

interface Props<T extends TechnicalStrapLineLike> {
  line: T;
  label: string;
  catalog?: TechnicalStrapSourceCatalog | null;
  loading?: boolean;
  failed?: boolean;
  onChange: (line: T) => void;
  children?: ReactNode;
}

/**
 * Identidade artesanal vs comprada NÃO é mais decidida na ficha (spec
 * origem-tira-pv-hub-os). A ficha só completa o grupo acabado quando a medida
 * do Hub é exclusivamente SKU acabado; o restante vai para Hub + PV.
 */
export default function TechnicalStrapSourceEditor<T extends TechnicalStrapLineLike>({
  line, label, catalog, loading, failed, onChange, children,
}: Props<T>) {
  const policy = technicalStrapSourcePolicy(catalog, line.measure_id);
  const sourceAllowed = isTechnicalStrapSourceAllowed(line, policy);
  const onlyFinished = policy.loaded && !policy.allowsReferenceBase && policy.finishedGroups.length > 0;
  const onlyFactory = policy.loaded && policy.allowsReferenceBase && policy.finishedGroups.length === 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Origem da tira</Label>
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {loading && 'Carregando catálogo do Hub…'}
          {failed && 'Catálogo indisponível — recarregue antes de salvar.'}
          {!loading && !failed && onlyFinished && 'SKU acabado (Hub). Sem seletor no pedido.'}
          {!loading && !failed && onlyFactory && 'Produção na fábrica (Hub). Sem seletor no pedido.'}
          {!loading && !failed && policy.allowsReferenceBase && policy.finishedGroups.length > 0 && (
            'Hub permite os dois caminhos — a escolha fábrica vs prestador fica no Pedido de Venda.'
          )}
          {!loading && !failed && policy.loaded && !policy.allowsReferenceBase && policy.finishedGroups.length === 0 && (
            'Esta medida ainda não tem origem ativa no Hub de Tiras.'
          )}
          {!loading && !failed && !policy.loaded && 'Origem definida no Hub e no Pedido de Venda — não nesta ficha.'}
        </div>
        {policy.loaded && !sourceAllowed && !loading && !failed && onlyFinished && (
          <p className="text-xs text-destructive">
            Selecione o grupo do produto acabado abaixo.
          </p>
        )}
      </div>
      {children}
      {(strapIdentityBasis(line) === 'finished_product_group' || onlyFinished) && (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">
            Grupo do produto acabado <span className="text-destructive">*</span>
          </Label>
          <Select
            value={line.identity_group_id || ''}
            disabled={loading || failed || policy.finishedGroups.length === 0}
            onValueChange={(groupId) => {
              if (!policy.finishedGroups.some(group => group.id === groupId)) return;
              onChange({
                ...applyTechnicalStrapIdentity(line, 'finished_product_group', groupId),
                internal_production_enabled: false,
              });
            }}
          >
            <SelectTrigger aria-label={`Grupo acabado de ${label}`}>
              <SelectValue placeholder="Selecione o grupo acabado" />
            </SelectTrigger>
            <SelectContent>
              {policy.finishedGroups.map(group => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Origem fixa no PV: <strong>SKU acabado</strong>.
          </p>
        </div>
      )}
    </div>
  );
}
