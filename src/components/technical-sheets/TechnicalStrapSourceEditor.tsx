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

export default function TechnicalStrapSourceEditor<T extends TechnicalStrapLineLike>({
  line, label, catalog, loading, failed, onChange, children,
}: Props<T>) {
  const policy = technicalStrapSourcePolicy(catalog, line.measure_id);
  const sourceAllowed = isTechnicalStrapSourceAllowed(line, policy);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">
          Base da identidade <span className="text-destructive">*</span>
        </Label>
        <Select
          value={strapIdentityBasis(line)}
          disabled={loading || failed || (!policy.allowsReferenceBase && policy.finishedGroups.length === 0)}
          onValueChange={(value) => {
            if (value !== 'reference_base' && value !== 'finished_product_group') return;
            if (value === 'reference_base' ? !policy.allowsReferenceBase : policy.finishedGroups.length === 0) return;
            const groupId = policy.finishedGroups.some(group => group.id === line.identity_group_id)
              ? line.identity_group_id
              : policy.finishedGroups.length === 1 ? policy.finishedGroups[0].id : null;
            onChange({
              ...applyTechnicalStrapIdentity(line, value, groupId),
              internal_production_enabled: value === 'reference_base',
            });
          }}
        >
          <SelectTrigger aria-label={`Base da identidade de ${label}`}>
            <SelectValue placeholder="Selecione uma origem disponível" />
          </SelectTrigger>
          <SelectContent>
            {policy.allowsReferenceBase && <SelectItem value="reference_base">Produzida a partir do material do cabedal</SelectItem>}
            {policy.finishedGroups.length > 0 && <SelectItem value="finished_product_group">Grupo próprio · comprada pronta</SelectItem>}
          </SelectContent>
        </Select>
        {policy.loaded && !sourceAllowed && !loading && !failed && (
          <p className="text-xs text-destructive">
            {policy.allowsReferenceBase || policy.finishedGroups.length > 0
              ? 'Escolha uma origem cadastrada para esta família e medida.'
              : 'Esta família e medida ainda não possui origem ativa no catálogo de tiras.'}
          </p>
        )}
      </div>
      {children}
      {strapIdentityBasis(line) === 'finished_product_group' && (
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
            Origem fixa no PV: <strong>Comprar pronta</strong>.
          </p>
        </div>
      )}
    </div>
  );
}
