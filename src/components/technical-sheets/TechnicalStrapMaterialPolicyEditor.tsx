import { useId, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import {
  applyStrapMaterialPolicy,
  MAX_STRAP_MATERIAL_GROUPS,
  strapMaterialMode,
  validateStrapMaterialPolicy,
  type StrapMaterialMode,
  type StrapMaterialPolicyLike,
} from '@/lib/strapMaterialPolicy';

interface MaterialGroup {
  id: string;
  name: string;
}

interface Props {
  line: StrapMaterialPolicyLike;
  label: string;
  groups: MaterialGroup[];
  /** Rótulos já gravados continuam visíveis mesmo após perder elegibilidade. */
  knownGroups?: MaterialGroup[];
  loading?: boolean;
  failed?: boolean;
  onChange: (line: StrapMaterialPolicyLike) => void;
}

export default function TechnicalStrapMaterialPolicyEditor({
  line, label, groups, knownGroups = [], loading = false, failed = false, onChange,
}: Props) {
  const fieldId = useId();
  const [search, setSearch] = useState('');
  const mode = strapMaterialMode(line);
  const allowed = Array.isArray(line.allowed_material_group_ids) ? line.allowed_material_group_ids : [];
  const eligibleIds = new Set(groups.map(group => group.id));
  const selectedIds = new Set([line.material_group_id, ...allowed].filter(Boolean));
  const displayedGroups = [...groups];
  selectedIds.forEach(id => {
    if (!eligibleIds.has(id)) displayedGroups.push({
      id, name: knownGroups.find(group => group.id === id)?.name || 'Material indisponível',
    });
  });
  displayedGroups.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  const filteredGroups = displayedGroups.filter(group => searchMatchesAllTerms(search, group.name));
  const issues = validateStrapMaterialPolicy(line, loading || failed ? undefined : eligibleIds);
  const changePolicy = (nextMode: StrapMaterialMode, groupId?: string | null, groupIds?: readonly string[]) => {
    onChange(applyStrapMaterialPolicy(line, nextMode, groupId, groupIds));
  };

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-mode`} className="text-xs font-semibold">Material desta posição</Label>
        <Select value={mode || ''} onValueChange={value => changePolicy(value as StrapMaterialMode)}>
          <SelectTrigger id={`${fieldId}-mode`} aria-label={`Política de material de ${label}`}>
            <SelectValue placeholder="Escolha uma política de material válida" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="follow_reference">Segue o material da referência</SelectItem>
            <SelectItem value="fixed_group">Material fixo nesta posição</SelectItem>
            <SelectItem value="select_on_order">Selecionar material no pedido</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode === 'fixed_group' && (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-group`} className="text-xs font-semibold">Material fixo</Label>
          <Select
            value={line.material_group_id || ''}
            disabled={loading || failed}
            onValueChange={groupId => changePolicy('fixed_group', groupId)}
          >
            <SelectTrigger id={`${fieldId}-group`} aria-label={`Material fixo de ${label}`}>
              <SelectValue placeholder="Selecione o material do cabedal" />
            </SelectTrigger>
            <SelectContent>
              {displayedGroups.map(group => (
                <SelectItem key={group.id} value={group.id} disabled={!eligibleIds.has(group.id)}>
                  {group.name}{!eligibleIds.has(group.id) ? ' · indisponível' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {mode === 'select_on_order' && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold">Materiais permitidos no pedido</legend>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar material permitido..."
            aria-label={`Buscar materiais de ${label}`}
          />
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border bg-background p-2">
            {filteredGroups.map(group => {
              const checked = allowed.includes(group.id);
              return (
                <div key={group.id} className="flex items-center gap-2 p-1">
                  <Checkbox
                    id={`${fieldId}-${group.id}`}
                    checked={checked}
                    disabled={loading || failed || (!checked && (!eligibleIds.has(group.id) || allowed.length >= MAX_STRAP_MATERIAL_GROUPS))}
                    onCheckedChange={selected => changePolicy('select_on_order', null, selected === true
                      ? [...allowed, group.id]
                      : allowed.filter(id => id !== group.id))}
                  />
                  <Label htmlFor={`${fieldId}-${group.id}`} className="text-xs font-normal">
                    {group.name}{!eligibleIds.has(group.id) ? ' · indisponível' : ''}
                  </Label>
                </div>
              );
            })}
            {!loading && !failed && filteredGroups.length === 0 && (
              <p className="p-1 text-xs text-muted-foreground">Nenhum material encontrado.</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{allowed.length} material(is) autorizado(s) para esta posição.</p>
          {allowed.length >= MAX_STRAP_MATERIAL_GROUPS && (
            <p className="text-xs text-muted-foreground">Limite de {MAX_STRAP_MATERIAL_GROUPS} materiais por posição. Remova um para escolher outro.</p>
          )}
        </fieldset>
      )}
      {mode !== 'follow_reference' && (
        <p className="text-xs text-muted-foreground">
          Cada grupo é um material de estoque, inclusive os compostos. O consumo em cm/pé permanece o da grade;
          a conversão da tira usa a receita confirmada para a família, medida e material selecionados.
        </p>
      )}
      {loading && mode !== 'follow_reference' && <p className="text-xs text-muted-foreground">Carregando materiais elegíveis…</p>}
      {failed && mode !== 'follow_reference' && (
        <p role="alert" className="text-xs text-destructive">Não foi possível validar os materiais. Recarregue antes de salvar a ficha.</p>
      )}
      {issues.map(issue => <p key={issue} role="alert" className="text-xs text-destructive">{issue}</p>)}
    </div>
  );
}
