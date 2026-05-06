import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import { useGroups } from '@/hooks/useGroups';
import { useSuppliers } from '@/hooks/useSuppliers';

interface SearchBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  groupFilter: string;
  onGroupChange: (value: string) => void;
  supplierFilter?: string;
  onSupplierChange?: (value: string) => void;
}

export function SearchBar({ search, onSearchChange, groupFilter, onGroupChange, supplierFilter = 'all', onSupplierChange }: SearchBarProps) {
  const { data: groups = [] } = useGroups();
  const { data: suppliers = [] } = useSuppliers();

  // Build hierarchical group list: parent groups first, then children indented
  const groupOptions = useMemo(() => {
    const parentGroups = groups.filter(g => !g.parent_group_id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const childMap = new Map<string, typeof groups>();
    groups.filter(g => g.parent_group_id).forEach(g => {
      const children = childMap.get(g.parent_group_id!) || [];
      children.push(g);
      childMap.set(g.parent_group_id!, children);
    });

    const result: { id: string; label: string }[] = [];
    for (const parent of parentGroups) {
      const children = childMap.get(parent.id) || [];
      if (children.length > 0) {
        result.push({ id: parent.id, label: parent.name });
        children.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).forEach(c => {
          result.push({ id: c.id, label: `  └ ${c.name}` });
        });
      } else {
        result.push({ id: parent.id, label: parent.name });
      }
    }
    return result;
  }, [groups]);

  const activeSuppliers = useMemo(() =>
    suppliers.filter(s => s.active).sort((a, b) => (a.trade_name || a.name).localeCompare(b.trade_name || b.name, 'pt-BR')),
    [suppliers]
  );

  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, nome técnico ou SKU..."
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>
      <Select value={groupFilter} onValueChange={onGroupChange}>
        <SelectTrigger className="w-full sm:w-[200px]">
          <SelectValue placeholder="Todos grupos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos grupos</SelectItem>
          <SelectItem value="none">Sem grupo</SelectItem>
          {groupOptions.map(g => <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {onSupplierChange && (
        <Select value={supplierFilter} onValueChange={onSupplierChange}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Todos fornecedores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos fornecedores</SelectItem>
            <SelectItem value="none">Sem fornecedor</SelectItem>
            {activeSuppliers.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.trade_name || s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
