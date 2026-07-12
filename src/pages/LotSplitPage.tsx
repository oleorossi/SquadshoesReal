import { useMemo, useState } from 'react';
import { Scissors, Info, ArrowsClockwise, CheckCircle, MagnifyingGlass } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { useSplitSuggestions, useSplitOrderMutation, type SplitSuggestion } from '@/hooks/useOrderLots';

export default function LotSplitPage() {
  const { data: suggestions = [], isLoading, refetch } = useSplitSuggestions();
  const splitMutation = useSplitOrderMutation();
  const [search, setSearch] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<SplitSuggestion | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return suggestions;
    return suggestions.filter(s =>
      searchMatchesAllTerms(search, s.order_number, s.sale_order_number, s.sheet_code, s.sheet_name, s.color)
    );
  }, [suggestions, search]);

  const totalPotentialPairs = filtered.reduce((sum, s) => sum + s.quantity, 0);

  return (
    <div className="space-y-4">
      {/* Header explicativo */}
      <Card className="p-4 border-l-4 border-l-primary">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="space-y-1.5 text-sm">
            <p className="font-semibold text-foreground">
              Lot Sizing — divide OPs grandes em lotes do tamanho do gargalo
            </p>
            <p className="text-muted-foreground leading-snug">
              OPs onde a quantidade ultrapassa 2 dias de capacidade do setor mais lento aparecem
              aqui. Splitar permite que o primeiro lote saia do gargalo antes do último entrar,
              liberando caixa antecipado quando combinado com faturamento por lote.
            </p>
            <p className="text-xs text-muted-foreground">
              <strong>Capacidade do gargalo</strong> = menor capacity_per_day entre os setores ativos da ficha.
              Se uma ficha não tem capacities configuradas, usa 100 pares/dia como fallback.
            </p>
          </div>
        </div>
      </Card>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <SearchInput
            className="flex-1"
            value={search}
            onChange={setSearch}
            placeholder="Buscar por OP, PV, ficha, cor…"
            resultCount={filtered.length}
            totalCount={suggestions.length}
            inputClassName="h-9"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
            {filtered.length} {filtered.length === 1 ? 'sugestão' : 'sugestões'}
            {filtered.length > 0 && ` · ${totalPotentialPairs} pares`}
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <ArrowsClockwise className="h-3.5 w-3.5" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando sugestões…</Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={search.trim() ? MagnifyingGlass : CheckCircle}
          title={search.trim() ? `Nenhum resultado para "${search}"` : 'Nenhuma OP candidata a split'}
          description={
            search.trim()
              ? 'Tente outro termo de busca.'
              : 'Todas as OPs ativas estão dentro de 2 dias do gargalo. Sem necessidade de splitar agora.'
          }
          action={
            search.trim() ? (
              <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                Limpar busca
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]">OP</TableHead>
                <TableHead className="w-[110px]">PV</TableHead>
                <TableHead>Ficha · Cor</TableHead>
                <TableHead className="text-right w-[90px]">Pares</TableHead>
                <TableHead className="text-right w-[110px]">Gargalo cap/dia</TableHead>
                <TableHead className="text-right w-[110px]">Lotes sugeridos</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.order_id}>
                  <TableCell className="font-mono text-xs">{s.order_number}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.sale_order_number || '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm">{s.sheet_code}</span>
                      <span className="text-[11px] text-muted-foreground truncate max-w-[260px]">
                        {s.sheet_name}{s.color ? ` · ${s.color}` : ''}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold">
                    {s.quantity}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {s.bottleneck_capacity}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="default" className="font-mono">
                      {s.suggested_lots}× {Math.ceil(s.quantity / s.suggested_lots)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground capitalize">
                      {s.production_step || s.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => setConfirmTarget(s)}
                      disabled={splitMutation.isPending}
                      className="gap-1.5 h-7"
                    >
                      <Scissors className="h-3 w-3" />
                      Splitar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Confirmação */}
      <AlertDialog open={!!confirmTarget} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Splitar OP {confirmTarget?.order_number}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <strong>{confirmTarget?.sheet_code}</strong>
                  {confirmTarget?.color && ` · ${confirmTarget.color}`} — {confirmTarget?.quantity} pares
                </p>
                <p>
                  Será dividida em <strong>{confirmTarget?.suggested_lots} lotes</strong> de até{' '}
                  <strong>{confirmTarget?.bottleneck_capacity} pares</strong> cada (capacidade diária do gargalo).
                </p>
                <p className="text-xs text-muted-foreground">
                  Cada lote vai ter sua própria ficha de operador. Pra desfazer, use o reset (só funciona enquanto
                  todos os lotes ainda estão pendentes).
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmTarget) {
                  splitMutation.mutate(confirmTarget.order_id);
                  setConfirmTarget(null);
                }
              }}
            >
              Splitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
