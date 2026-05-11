import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Boxes, Edit3, AlertTriangle, AlertCircle, Link2 } from 'lucide-react';
import { SoladoGradeDialog } from '@/components/inventory/SoladoGradeDialog';
import type { Product } from '@/types/inventory';
import type { SoleProduct } from './types';

interface Props {
  sole: SoleProduct;
}

function gradeTotal(grade: Record<string, any> | null): number {
  if (!grade) return 0;
  return Object.entries(grade)
    .filter(([k]) => !k.startsWith('_'))
    .reduce((s, [, v]) => s + (Number(v) || 0), 0);
}

export default function SolesEstoqueTab({ sole }: Props) {
  const [editOpen, setEditOpen] = useState(false);

  // Carrega o registro completo do produto pra abrir o SoladoGradeDialog
  const { data: fullProduct } = useQuery({
    queryKey: ['products', sole.id, 'full'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').eq('id', sole.id).single();
      if (error) throw error;
      return data as unknown as Product;
    },
    staleTime: 10_000,
  });

  const grade = (sole.stock_grade ?? {}) as Record<string, number>;
  const realKeys = Object.keys(grade)
    .filter(k => !k.startsWith('_'))
    .sort((a, b) => {
      // Conjugadas (ex.: "33/34") ordenadas pelo menor número
      const ax = Number(a.split('/')[0]);
      const bx = Number(b.split('/')[0]);
      return ax - bx;
    });

  // Quando o range está cadastrado mas o estoque inicial nunca foi lançado,
  // geramos as keys vazias do range (default 33-40) pra mostrar a tabela com
  // zeros em vez de empty state. Sinaliza estoque "ainda não inicializado".
  const sizeFrom = (grade as any)._size_from ?? 33;
  const sizeTo = (grade as any)._size_to ?? 40;
  const isUninitialized = realKeys.length === 0;
  const sizeKeys = isUninitialized
    ? Array.from({ length: sizeTo - sizeFrom + 1 }, (_, i) => String(sizeFrom + i))
    : realKeys;

  const total = gradeTotal(sole.stock_grade);
  const minTotal = sole.min_stock || 0;
  const isLow = total < minTotal;
  const isZero = total === 0;

  return (
    <div className="space-y-4">
      <Card className="border-dashed">
        <CardContent className="py-3 px-4 flex items-start gap-2">
          <Boxes className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Esta aba mostra <strong>apenas a quantidade</strong> de pares por numeração — pra usar nos pedidos
            de venda. Tudo mais (conjugação, consumos, silk) está nas outras abas.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Boxes className="h-4 w-4 text-primary" />
              Estoque por numeração
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Total: <span className="font-mono font-bold">{total}</span> pares
              {minTotal > 0 && <> · Mínimo: <span className="font-mono">{minTotal}</span></>}
              {isZero && <Badge variant="destructive" className="ml-2 text-[10px]">Zerado</Badge>}
              {isLow && !isZero && <Badge className="ml-2 text-[10px] bg-amber-500/15 text-amber-700 border-amber-300">Abaixo do mínimo</Badge>}
            </p>
          </div>
          <Button size="sm" onClick={() => setEditOpen(true)} disabled={!fullProduct} className="gap-1.5">
            <Edit3 className="h-3 w-3" /> Editar estoque
          </Button>
        </CardHeader>
        <CardContent>
          {isUninitialized && (
            <div className="mb-3 px-3 py-2 rounded-md bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/40 text-xs text-amber-800 dark:text-amber-200">
              Range cadastrado ({sizeFrom}–{sizeTo}), mas o estoque inicial não foi lançado.
              Use <strong>Editar estoque</strong> pra adicionar quantidades por numeração.
            </div>
          )}
          {sizeKeys.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Boxes className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhuma numeração cadastrada</p>
              <p className="text-xs mt-1">Configure o range na aba <strong>Cadastro</strong> primeiro.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {sizeKeys.map(k => {
                const qty = Number(grade[k]) || 0;
                const isConjugated = k.includes('/');
                const isZeroCell = qty === 0;
                return (
                  <div
                    key={k}
                    className={`rounded-lg border-l-4 border-t border-r border-b p-2.5 text-center transition-colors relative ${
                      isZeroCell
                        ? 'bg-rose-50/40 dark:bg-rose-950/10 border-t-rose-200/60 border-r-rose-200/60 border-b-rose-200/60 border-l-rose-500 dark:border-l-rose-400'
                        : 'bg-card border-l-emerald-500/50 hover:bg-muted/40'
                    }`}
                    title={isZeroCell ? `Tamanho ${k}: sem estoque` : `Tamanho ${k}: ${qty} pares`}
                  >
                    {isZeroCell && (
                      <AlertCircle
                        className="absolute top-1 right-1 h-3 w-3 text-rose-500"
                        aria-label="Sem estoque"
                      />
                    )}
                    <div className="flex items-center justify-center gap-1">
                      <p className={`text-sm font-mono ${isConjugated ? 'text-primary font-bold' : 'text-muted-foreground'}`}>{k}</p>
                      {isConjugated && (
                        <Link2 className="h-2.5 w-2.5 text-primary" aria-label="Tamanho conjugado" />
                      )}
                    </div>
                    <p className={`text-xl font-bold font-mono mt-1 leading-none ${isZeroCell ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'}`}>
                      {qty}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alertas */}
      {(isLow || isZero) && (
        <Card className="border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/10">
          <CardContent className="py-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs">
              {isZero ? (
                <p className="text-rose-700 dark:text-rose-400 font-medium">Solado zerado — venda bloqueada até reposição.</p>
              ) : (
                <p className="text-amber-700 dark:text-amber-400 font-medium">Estoque abaixo do mínimo configurado.</p>
              )}
              <p className="text-muted-foreground mt-0.5">
                Use o botão <strong>Editar estoque</strong> pra ajustar quantidades, ou crie uma OC pelo Planejamento de Compras.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {fullProduct && (
        <SoladoGradeDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          product={fullProduct}
        />
      )}
    </div>
  );
}
