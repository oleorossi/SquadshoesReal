import { useMemo, useState } from 'react';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { MagnifyingGlass as Search, BookOpen, ArrowsClockwise } from '@phosphor-icons/react';
import { useQualityDefectCatalog } from '@/hooks/useQualityDefectCatalog';
import { normalizeForSearch } from '@/lib/searchUtils';

const SEVERITY_TONE: Record<string, string> = {
  minor:    'border-amber-400/60 text-amber-700',
  major:    'bg-orange-500/15 text-orange-700 border-orange-400/40',
  critical: 'bg-red-500/15 text-red-700 border-red-500/40',
};

const CATEGORY_LABEL: Record<string, string> = {
  material:   'Material',
  processo:   'Processo',
  acabamento: 'Acabamento',
  embalagem:  'Embalagem',
};

export function DefectCatalogPanel() {
  const { data: defects = [], isLoading } = useQualityDefectCatalog();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sector, setSector] = useState('all');

  const sectors = useMemo(() => {
    const set = new Set<string>();
    defects.forEach(d => d.default_sector && set.add(d.default_sector));
    return [...set].sort();
  }, [defects]);

  const filtered = useMemo(() => {
    return defects.filter(d => {
      if (category !== 'all' && d.category !== category) return false;
      if (sector !== 'all' && d.default_sector !== sector) return false;
      if (search.trim()) {
        const q = normalizeForSearch(search.trim());
        return normalizeForSearch(d.name).includes(q)
          || normalizeForSearch(d.code).includes(q)
          || normalizeForSearch(d.description || '').includes(q);
      }
      return true;
    });
  }, [defects, category, sector, search]);

  return (
    <div className="space-y-4">
      <Panel
        eyebrow="QUALIDADE · CATÁLOGO PADRÃO"
        title={`${defects.length} defeitos típicos de calçado`}
        subtitle="Biblioteca pré-populada com defeitos por setor. Use no registro de ocorrências pra padronizar análise. Edição administrativa via banco — em iteração futura."
      >
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome, código ou descrição..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas categorias</SelectItem>
              <SelectItem value="material">Material</SelectItem>
              <SelectItem value="processo">Processo</SelectItem>
              <SelectItem value="acabamento">Acabamento</SelectItem>
              <SelectItem value="embalagem">Embalagem</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sector} onValueChange={setSector}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos setores</SelectItem>
              {sectors.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="text-center py-10 text-muted-foreground text-sm">Carregando catálogo...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={BookOpen} title="Nenhum defeito encontrado" description="Ajuste os filtros pra ver o catálogo padrão." size="sm" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead className="w-28">Código</TableHead>
                <TableHead>Defeito</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Setor típico</TableHead>
                <TableHead>Severidade padrão</TableHead>
                <TableHead className="text-center">Retrabalhável?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(d => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.code}</TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">{d.name}</div>
                    {d.description && <div className="text-xs text-muted-foreground">{d.description}</div>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{CATEGORY_LABEL[d.category] || d.category}</TableCell>
                  <TableCell className="text-sm">{d.default_sector || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${SEVERITY_TONE[d.default_severity] || ''}`}>
                      {d.default_severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {d.can_rework ? (
                      <Badge variant="outline" className="text-xs gap-1 text-emerald-700 border-emerald-500/40">
                        <ArrowsClockwise className="h-3 w-3" /> Sim
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Refugo</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

export default DefectCatalogPanel;
