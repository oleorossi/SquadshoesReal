import AppLayout from "@/components/layout/AppLayout";
 import { CircleNotch as Loader2, ArrowDownRight, ArrowUpRight, Funnel as Filter, User, ArrowsClockwise as RefreshCw, Warning as AlertTriangle } from '@phosphor-icons/react';
 import { SearchInput } from '@/components/ui/search-input';
 import { TableCell, TableHead } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
 import { useStockMovements, StockMovementWithProduct } from '@/hooks/useOrders';
import { SelectableTable } from '@/components/ui/selectable-table';
import { useTableSelection } from '@/hooks/useTableSelection';
import { normalizeForSearch } from '@/lib/searchUtils';
 import { useMemo, useState } from 'react';
 import { Input } from '@/components/ui/input';
 import { Button } from '@/components/ui/button';
 import { Label } from '@/components/ui/label';
 import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
 import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
 import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
 import { getStockGradeChanges } from '@/lib/stockQuantity';

  export default function StockHistory({ filterProductId, hideHeader = false }: { filterProductId?: string; hideHeader?: boolean }) {
   const [typeFilter, setTypeFilter] = useState<string>('all');
   const [searchQuery, setSearchQuery] = useState('');
   const [userFilter, setUserFilter] = useState('');
   const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
   const [currentPage, setCurrentPage] = useState(1);
   const itemsPerPage = 10;

    // Busca SERVER-SIDE (spec R6): o termo vai pro banco via search_norm +
    // produtos que casam (nome/sku/cor) — acha movimentação além do limit local.
    const { data: allMovements = [] as StockMovementWithProduct[], isLoading, isError, refetch } = useStockMovements({
      search: searchQuery,
      productId: filterProductId,
    });

    const movements = useMemo<StockMovementWithProduct[]>(() => {
      let filtered = [...allMovements];

      if (filterProductId) {
        filtered = filtered.filter(mov => mov.product_id === filterProductId);
      }

      return filtered.filter((mov) => {
        if (typeFilter !== 'all' && mov.movement_type !== typeFilter) return false;

        if (userFilter) {
          const matchesUser =
            (normalizeForSearch(mov.user_email).includes(normalizeForSearch(userFilter))) ||
            (normalizeForSearch(mov.responsible).includes(normalizeForSearch(userFilter)));
          if (!matchesUser) return false;
        }

        if (dateRange.from && new Date(mov.created_at) < new Date(dateRange.from)) return false;
        if (dateRange.to) {
          const toDate = new Date(dateRange.to);
          toDate.setHours(23, 59, 59, 999);
          if (new Date(mov.created_at) > toDate) return false;
        }

        return true;
      });
    }, [allMovements, filterProductId, typeFilter, userFilter, dateRange]);
 
   const paginatedMovements = useMemo<StockMovementWithProduct[]>(() => {
     const start = (currentPage - 1) * itemsPerPage;
     return movements.slice(start, start + itemsPerPage);
   }, [movements, currentPage]);
 
   const totalPages = Math.ceil(movements.length / itemsPerPage);

   const selection = useTableSelection<StockMovementWithProduct>({
     items: paginatedMovements,
    getId: (mov) => mov.id,
  });

  const headers = useMemo(() => (
    <>
      <TableHead>Tipo</TableHead>
      <TableHead>Material</TableHead>
      <TableHead>SKU</TableHead>
      <TableHead className="text-right">Quantidade</TableHead>
      <TableHead className="text-right">Estoque Anterior</TableHead>
      <TableHead className="text-right">Estoque Atual</TableHead>
      <TableHead>Descrição</TableHead>
      <TableHead>Data</TableHead>
      <TableHead>Responsável</TableHead>
    </>
  ), []);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="font-semibold text-foreground">Falha ao carregar dados</p>
        <p className="text-sm text-muted-foreground">Verifique sua conexão e recarregue a página.</p>
      </div>
    );
  }

   return (
     <div className="space-y-5 page-enter">
       {!hideHeader && (
         <EditorialPageHeader
           sectionLabel="ESTOQUE · HISTÓRICO"
           title="Histórico de Movimentações"
           description="Registro de todas as entradas e saídas de estoque"
         />
       )}

       <div className="flex flex-wrap gap-3 items-end">
         <SearchInput
           className="flex-1 min-w-[200px]"
           placeholder="Buscar por material, SKU, descrição ou motivo…"
           value={searchQuery}
           onChange={setSearchQuery}
           debounceMs={300}
           inputClassName="h-9"
         />
         
         <div className="w-[150px]">
           <Select value={typeFilter} onValueChange={setTypeFilter}>
             <SelectTrigger className="h-9">
               <Filter className="h-4 w-4 mr-2" />
               <SelectValue placeholder="Tipo" />
             </SelectTrigger>
             <SelectContent>
               <SelectItem value="all">Todos Tipos</SelectItem>
               <SelectItem value="in">Entradas</SelectItem>
               <SelectItem value="out">Saídas</SelectItem>
             </SelectContent>
           </Select>
         </div>
 
         <div className="w-[180px]">
           <div className="relative">
             <User className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
             <Input
               placeholder="Responsável..."
               className="pl-9 h-9"
               value={userFilter}
               onChange={(e) => setUserFilter(e.target.value)}
             />
           </div>
         </div>
 
         <div className="flex gap-2">
           <div className="flex flex-col gap-1">
             <Label className="text-xs text-muted-foreground ml-1">De</Label>
             <Input 
               type="date" 
               className="h-9 w-[140px]" 
               value={dateRange.from || ''} 
               onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
             />
           </div>
           <div className="flex flex-col gap-1">
             <Label className="text-xs text-muted-foreground ml-1">Até</Label>
             <Input 
               type="date" 
               className="h-9 w-[140px]" 
               value={dateRange.to || ''} 
               onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
             />
           </div>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9" 
              onClick={() => { 
                setTypeFilter('all'); 
                setSearchQuery(''); 
                setUserFilter(''); 
                setDateRange({}); 
                refetch();
              }}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
         </div>
       </div>
 
      <SelectableTable
        selection={selection}
         items={paginatedMovements}
        getId={(mov) => mov.id}
        headers={headers}
        headerClassName="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground"
        emptyMessage={searchQuery.trim() ? `Nenhum resultado para "${searchQuery.trim()}"` : 'Nenhuma movimentação registrada'}
       renderRow={(mov: StockMovementWithProduct) => {
         const prod = mov.products;
         const isOut = mov.movement_type === 'out';
         const gradeChanges = getStockGradeChanges(mov.previous_grade, mov.new_grade);
          return (
            <>
              <TableCell>
                <Badge variant="outline" className={isOut ? 'bg-destructive/15 text-destructive border-destructive/30 text-xs' : 'bg-success/15 text-success border-success/30 text-xs'}>
                  <span className="flex items-center gap-1">
                    {isOut ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                    {isOut ? 'Saída' : 'Entrada'}
                  </span>
                </Badge>
              </TableCell>
              <TableCell className="font-medium">{prod?.name ?? '—'}</TableCell>
              <TableCell className="font-mono text-sm text-muted-foreground">{prod?.sku ?? '—'}</TableCell>
              <TableCell className="text-right font-mono">{Number(mov.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {prod?.unit ?? ''}</TableCell>
              <TableCell className="text-right font-mono text-muted-foreground">{Number(mov.previous_stock).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right font-mono">{Number(mov.new_stock).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <span>{mov.description || '—'}</span>
                {gradeChanges.length > 0 && (
                  <div className="mt-1.5 flex max-w-sm flex-wrap gap-1" aria-label="Alterações por numeração">
                    {gradeChanges.slice(0, 8).map((change) => (
                      <span
                        key={change.size}
                        className="border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                        title={`Numeração ${change.size}: ${change.previous} para ${change.next}`}
                      >
                        {change.size}: {change.previous.toLocaleString('pt-BR')}→{change.next.toLocaleString('pt-BR')}
                      </span>
                    ))}
                    {gradeChanges.length > 8 && (
                      <span className="px-1 py-0.5 text-[11px]">+{gradeChanges.length - 8}</span>
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {mov.created_at ? new Date(mov.created_at).toLocaleString('pt-BR') : '—'}
              </TableCell>
               <TableCell className="text-sm text-muted-foreground flex items-center gap-1.5">
                 {mov.user_email || mov.responsible || '—'}
                 {mov.lot_number && (
                   <Badge variant="outline" className="text-xs py-0 h-4 font-mono">
                     Lote: {mov.lot_number}
                   </Badge>
                 )}
               </TableCell>
            </>
          );
        }}
      />
 
       {totalPages > 1 && (
         <Pagination className="mt-4">
           <PaginationContent>
             <PaginationItem>
               <PaginationPrevious 
                 onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                 className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
               />
             </PaginationItem>
             {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
               <PaginationItem key={page}>
                 <PaginationLink onClick={() => setCurrentPage(page)} isActive={currentPage === page}>{page}</PaginationLink>
               </PaginationItem>
             ))}
             <PaginationItem>
               <PaginationNext 
                 onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                 className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
               />
             </PaginationItem>
           </PaginationContent>
         </Pagination>
       )}
    </div>
  );
}
