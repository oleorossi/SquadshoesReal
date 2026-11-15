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
 * Origem na ficha: deriva do grupo de estoque (R4) ou da medida Hub quando
 * ainda há ponte. Buy-ready pinado no identity_group_id não exige Hub.
 */
export default function TechnicalStrapSourceEditor<T extends TechnicalStrapLineLike>({
  line, label, catalog, loading, failed, onChange, children,
}: Props<T>) {
  const stockPinned = strapIdentityBasis(line) === 'finished_product_group' && !!line.identity_group_id;
  const policy = technicalStrapSourcePolicy(catalog, line.measure_id);
  const sourceAllowed = isTechnicalStrapSourceAllowed(line, policy);
  const onlyFinished = (policy.loaded && !policy.allowsReferenceBase && policy.finishedGroups.length > 0)
    || (stockPinned && (!line.measure_id || !policy.allowsReferenceBase));
  const onlyFactory = policy.loaded && policy.allowsReferenceBase && policy.finishedGroups.length === 0 && !stockPinned;
  // Grupo já pinado no seletor de estoque: não duplica o picker. Sem pin,
  // medida buy-ready do Hub ainda precisa escolher o grupo acabado aqui.
  const showFinishedPicker = !stockPinned
    && (strapIdentityBasis(line) === 'finished_product_group' || onlyFinished)
    && policy.finishedGroups.length > 0
    && !!line.measure_id;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Origem da tira</Label>
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {loading && 'Carregando catálogo auxiliar…'}
          {failed && 'Catálogo auxiliar indisponível — recarregue antes de salvar.'}
          {!loading && !failed && stockPinned && 'Comprar pronto — grupo de estoque selecionado na ficha.'}
          {!loading && !failed && !stockPinned && onlyFinished && 'Comprar pronto (grupo acabado). Origem fixa pela identidade do produto.'}
          {!loading && !failed && onlyFactory && 'Prestador: a napa vai ao prestador. O pedido pode trocar para Comprar pronto quando houver grupo acabado.'}
          {!loading && !failed && !stockPinned && policy.allowsReferenceBase && policy.finishedGroups.length > 0 && (
            'Prestador ou Comprar pronto — o padrão vem do cadastro e o Pedido de Venda pode trocar na exceção.'
          )}
          {!loading && !failed && !stockPinned && !line.measure_id && !line.identity_group_id && (
            'Selecione o grupo de estoque da tira para ver a origem.'
          )}
          {!loading && !failed && !!line.measure_id && policy.loaded && !policy.allowsReferenceBase && policy.finishedGroups.length === 0 && !stockPinned && (
            'Esta medida ainda não tem origem ativa — escolha o grupo de estoque.'
          )}
        </div>
        {policy.loaded && !sourceAllowed && !loading && !failed && onlyFinished && !stockPinned && (
          <p className="text-xs text-destructive">
            Selecione o grupo do produto acabado abaixo.
          </p>
        )}
      </div>
      {children}
      {showFinishedPicker && (
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
            Origem fixa no PV: <strong>Comprar pronto</strong>.
          </p>
        </div>
      )}
    </div>
  );
}
