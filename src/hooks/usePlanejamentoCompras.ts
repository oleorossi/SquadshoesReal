import { useState, useCallback, useMemo } from 'react';
import { planejamentoService, CalculoCusto, ResumoCalculoCompras, DadosMaterialPlanejamento } from '@/services/planejamento';
import { ConversaoUnidadeError } from '@/services/conversao';

type OrderBy = 'custo' | 'urgencia' | 'nome';
type FilterCategory = 'todos' | 'ok' | 'baixo' | 'critico';

export function usePlanejamentoCompras() {
  const [calculos, setCalculos] = useState<CalculoCusto[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('todos');
  const [orderBy, setOrderBy] = useState<OrderBy>('urgencia');

  const calcularCustos = useCallback(async (dados: DadosMaterialPlanejamento[]) => {
    setLoading(true);
    setErro(null);
    try {
      const resultado = planejamentoService.calcularCustosMateriais(dados);
      setCalculos(resultado);
    } catch (err) {
      setErro(err instanceof ConversaoUnidadeError ? err.message : 'Erro ao calcular custos');
      setCalculos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const calculosFiltrados = useMemo(() => {
    let resultado = [...calculos];
    if (filterCategory !== 'todos') {
      resultado = planejamentoService.filtrarPorCategoria(resultado, filterCategory);
    }
    return planejamentoService.ordenar(resultado, orderBy);
  }, [calculos, filterCategory, orderBy]);

  const resumo = useMemo(() => planejamentoService.gerarResumo(calculos), [calculos]);

  return {
    calculos: calculosFiltrados,
    calcularCustos,
    resumo,
    erro,
    loading,
    filterCategory,
    setFilterCategory,
    orderBy,
    setOrderBy,
    totalCalculos: calculos.length,
  };
}
