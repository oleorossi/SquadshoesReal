import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Stack as Boxes, PencilSimple as Edit3, Warning as AlertTriangle } from '@phosphor-icons/react';
import { SoladoGradeDialog } from '@/components/inventory/SoladoGradeDialog';
import { useSoleConjugations } from '@/hooks/useSoleConjugations';
import type { Product } from '@/types/inventory';
import type { SoleProduct } from './types';
import { getGradeQuantityForKey } from '@/lib/gradeDistribution';
import SoleStockMatrix from './SoleStockMatrix';

interface Props {
  sole: SoleProduct;
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

  // Conjugações do grupo (33/34, 39/40 etc) — usadas pra agrupar visualmente
  // tamanhos que compartilham molde. Ex: solado com conjugação 33/34
  // mostra "33/34: 50 pares" em vez de "33: 25, 34: 25" separados.
  // Adicionado 20/05/2026 — antes só funcionava se a key conjugada já existisse
  // no stock_grade, ignorando o caso de grades antigas com chaves individuais.
  const { data: conjugations = [] } = useSoleConjugations(sole.group_id ?? null);

  const sizeFrom = (grade as any)._size_from ?? 33;
  const sizeTo = (grade as any)._size_to ?? 40;

  // Calcula keys efetivas aplicando conjugações sobre o range. Pra cada
  // tamanho dentro do range, substitui pelo key conjugado quando existe;
  // senão usa o número individual.
  //
  // ⚠ Isto NÃO é mais a fonte dos números — a matriz vem da RPC
  //   `sole_stock_matrix`. Serve de FALLBACK: solado com range cadastrado e
  //   nada lançado não tem chave nenhuma no banco, e sem isto a tabela sumiria
  //   em vez de mostrar a grade vazia.
  const effectiveSizeKeys = useMemo<string[]>(() => {
    const result: string[] = [];
    const added = new Set<string>();
    const sortedConj = [...conjugations].sort((a, b) => a.display_order - b.display_order);
    for (let s = sizeFrom; s <= sizeTo; s++) {
      const conj = sortedConj.find(c => c.sizes.includes(s));
      if (conj) {
        if (!added.has(conj.size_key)) { result.push(conj.size_key); added.add(conj.size_key); }
      } else {
        result.push(String(s));
      }
    }
    return result;
  }, [conjugations, sizeFrom, sizeTo]);

  const isUninitialized = effectiveSizeKeys.every(
    k => (getGradeQuantityForKey(grade, k) || 0) === 0,
  );

  return (
    <div className="space-y-4">
      <Card className="border-dashed">
        <CardContent className="py-3 px-4 flex items-start gap-2">
          <Boxes className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Esta aba mostra <strong>quanto você tem, quanto está empenhado e quanto sobra</strong> por
            numeração, e quais pedidos consomem este solado. Conjugação, consumos e silk estão nas outras abas.
          </p>
        </CardContent>
      </Card>

      {/* Badge do tipo do solado — ajuda visualizar como o estoque é interpretado */}
      {(sole as any).sole_classification && (
        <Card className={
          (sole as any).sole_classification === 'tradicional' ? 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-800' :
          (sole as any).sole_classification === 'palmilha_pronta' ? 'border-violet-300 bg-violet-50/60 dark:bg-violet-950/20 dark:border-violet-800' :
          'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800'
        }>
          <CardContent className="py-2.5 px-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`text-xs font-bold uppercase tracking-wider
                ${(sole as any).sole_classification === 'tradicional' ? 'text-emerald-700 dark:text-emerald-400' : ''}
                ${(sole as any).sole_classification === 'palmilha_pronta' ? 'text-violet-700 dark:text-violet-400' : ''}
                ${(sole as any).sole_classification === 'conjugado' ? 'text-amber-700 dark:text-amber-400' : ''}
              `}>
                {(sole as any).sole_classification === 'tradicional' ? 'Solado Tradicional' : ''}
                {(sole as any).sole_classification === 'palmilha_pronta' ? 'Solado · Palmilha Pronta' : ''}
                {(sole as any).sole_classification === 'conjugado' ? 'Solado Conjugado' : ''}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {(sole as any).sole_classification === 'tradicional' && 'Cada número individual · palmilha em dm²'}
              {(sole as any).sole_classification === 'palmilha_pronta' && 'Palmilha em un · coligação cor cabedal'}
              {(sole as any).sole_classification === 'conjugado' && 'Algumas numerações agrupadas'}
            </span>
          </CardContent>
        </Card>
      )}

      {isUninitialized && (
        <div className="px-3 py-2 rounded-md bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/40 text-xs text-amber-800 dark:text-amber-200">
          Range cadastrado ({sizeFrom}–{sizeTo}), mas o estoque inicial não foi lançado.
          Use <strong>Editar estoque</strong> pra adicionar quantidades por numeração.
        </div>
      )}

      <SoleStockMatrix
        productId={sole.id}
        fallbackSizeKeys={effectiveSizeKeys}
        actions={
          <Button size="sm" onClick={() => setEditOpen(true)} disabled={!fullProduct} className="h-7 gap-1.5">
            <Edit3 className="h-3 w-3" /> Editar estoque
          </Button>
        }
      />

      {isUninitialized && (
        <Card className="border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/10">
          <CardContent className="py-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="text-rose-700 dark:text-rose-400 font-medium">Solado zerado — venda bloqueada até reposição.</p>
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
