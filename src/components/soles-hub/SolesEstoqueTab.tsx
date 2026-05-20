import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Stack as Boxes, PencilSimple as Edit3, Warning as AlertTriangle, WarningCircle as AlertCircle, Link as Link2 } from '@phosphor-icons/react';
import { SoladoGradeDialog } from '@/components/inventory/SoladoGradeDialog';
import { useSoleConjugations } from '@/hooks/useSoleConjugations';
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

  // Soma quantidade pra cada key: se for conjugado (ex: "33/34"), soma
  // qty_33 + qty_34 do grade existente (caso o stock_grade ainda esteja em
  // formato individual) OU usa a key conjugada se já estiver no grade.
  const qtyByKey = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const k of effectiveSizeKeys) {
      if (grade[k] != null) {
        out[k] = Number(grade[k]) || 0;
        continue;
      }
      if (k.includes('/')) {
        const parts = k.split('/').map(p => Number(p)).filter(n => !isNaN(n));
        out[k] = parts.reduce((s, n) => s + (Number(grade[String(n)]) || 0), 0);
      } else {
        out[k] = Number(grade[k]) || 0;
      }
    }
    return out;
  }, [effectiveSizeKeys, grade]);

  const isUninitialized = effectiveSizeKeys.every(k => (qtyByKey[k] || 0) === 0);
  const sizeKeys = effectiveSizeKeys;

  // Total a partir das keys efetivas — evita dupla contagem quando o
  // stock_grade tem AMBOS individuais (33, 34) e conjugado (33/34) em
  // estado transicional. qtyByKey já resolve a soma correta por key.
  const total = useMemo(() => Object.values(qtyByKey).reduce((s, v) => s + v, 0), [qtyByKey]);
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

      {/* Badge do tipo do solado — ajuda visualizar como o estoque é interpretado */}
      {(sole as any).sole_classification && (
        <Card className={
          (sole as any).sole_classification === 'tradicional' ? 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-800' :
          (sole as any).sole_classification === 'palmilha_pronta' ? 'border-violet-300 bg-violet-50/60 dark:bg-violet-950/20 dark:border-violet-800' :
          'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800'
        }>
          <CardContent className="py-2.5 px-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`text-[10px] font-bold uppercase tracking-wider
                ${(sole as any).sole_classification === 'tradicional' ? 'text-emerald-700 dark:text-emerald-400' : ''}
                ${(sole as any).sole_classification === 'palmilha_pronta' ? 'text-violet-700 dark:text-violet-400' : ''}
                ${(sole as any).sole_classification === 'conjugado' ? 'text-amber-700 dark:text-amber-400' : ''}
              `}>
                {(sole as any).sole_classification === 'tradicional' ? 'Solado Tradicional' : ''}
                {(sole as any).sole_classification === 'palmilha_pronta' ? 'Solado · Palmilha Pronta' : ''}
                {(sole as any).sole_classification === 'conjugado' ? 'Solado Conjugado' : ''}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {(sole as any).sole_classification === 'tradicional' && 'Cada número individual · palmilha em dm²'}
              {(sole as any).sole_classification === 'palmilha_pronta' && 'Palmilha em un · coligação cor cabedal'}
              {(sole as any).sole_classification === 'conjugado' && 'Algumas numerações agrupadas'}
            </span>
          </CardContent>
        </Card>
      )}

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
                const qty = qtyByKey[k] || 0;
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
