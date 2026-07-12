import { useState } from 'react';
import { ClipboardText as ClipboardCheck, Plus, MagnifyingGlass, Funnel as Filter, CheckCircle as CheckCircle2, XCircle, Warning as AlertTriangle, Info, Package, Calendar, User, ArrowRight } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { useQualityInspections, useQualityChecklists } from '@/hooks/useQualityInspections';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

export default function LotTestingTab() {
  const [search, setSearch] = useState('');
  const { data: inspections = [], isLoading } = useQualityInspections();
  const { data: checklists = [] } = useQualityChecklists();

  const filteredInspections = inspections.filter((i: any) =>
    searchMatchesAllTerms(search, i.orders?.order_number, i.quality_checklists?.name, i.notes, i.checklist_id)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex-1 w-full max-w-sm">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por OP, checklist, notas…"
            resultCount={filteredInspections.length}
            totalCount={inspections.length}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Nova Inspeção
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2 bg-primary/10 rounded-lg">
              <ClipboardCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">Total Realizado</p>
              <p className="display text-2xl tabular-nums">{inspections.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">Aprovados</p>
              <p className="display text-2xl tabular-nums text-emerald-600">
                {inspections.filter((i: any) => i.status === 'approved' || i.status === 'pass').length}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2 bg-destructive/10 rounded-lg">
              <XCircle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">Reprovados</p>
              <p className="display text-2xl tabular-nums text-destructive">
                {inspections.filter((i: any) => i.status === 'rejected' || i.status === 'fail').length}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>Data</TableHead>
              <TableHead>Checklist / Tipo</TableHead>
              <TableHead>OP / Lote</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-center">Defeitos</TableHead>
              <TableHead>Notas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10">Carregando...</TableCell>
              </TableRow>
            ) : filteredInspections.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="p-0">
                  {search ? (
                    <EmptyState
                      size="sm"
                      icon={MagnifyingGlass}
                      title={`Nenhum resultado para "${search}"`}
                      action={<Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>}
                    />
                  ) : (
                    <div className="text-center py-10 text-muted-foreground italic">Nenhuma inspeção encontrada.</div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filteredInspections.map((i: any) => (
                <TableRow key={i.id} className="hover:bg-muted/20">
                  <TableCell className="text-sm">
                    {i.created_at ? format(new Date(i.created_at), 'dd/MM/yy HH:mm', { locale: ptBR }) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{i.quality_checklists?.name || 'Inspeção Geral'}</div>
                    <div className="text-xs text-muted-foreground uppercase">ID: {i.checklist_id?.slice(0,8)}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Package className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium">{i.orders?.order_number || 'S/ OP'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {(i.status === 'approved' || i.status === 'pass') ? (
                      <Badge className="bg-emerald-500 hover:bg-emerald-600">Aprovado</Badge>
                    ) : (i.status === 'rejected' || i.status === 'fail') ? (
                      <Badge variant="destructive">Reprovado</Badge>
                    ) : (
                      <Badge variant="secondary">Pendente</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center font-bold text-destructive">
                    {i.defect_quantity || 0}
                  </TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">
                    {i.notes || '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
