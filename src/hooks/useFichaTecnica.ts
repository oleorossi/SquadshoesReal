import { useEffect, useState } from 'react';
import { fichaTecnicaService, FichaTecnicaComMateriais } from '@/services/supabase/fichas-tecnicas';

export const useFichaTecnica = (fichaId?: string) => {
  const [ficha, setFicha] = useState<FichaTecnicaComMateriais | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fichaId) return;
    const carregarFicha = async () => {
      setLoading(true);
      setError(null);
      const resultado = await fichaTecnicaService.obterCompleta(fichaId);
      if (!resultado) setError('Ficha técnica não encontrada');
      setFicha(resultado);
      setLoading(false);
    };
    carregarFicha();
  }, [fichaId]);

  const buscarPorCodigo = async (codigo: string) => {
    setLoading(true);
    setError(null);
    try {
      const resultado = await fichaTecnicaService.obterPorCodigo(codigo);
      if (!resultado) setError('Ficha técnica não encontrada');
      setFicha(resultado);
    } catch {
      setError('Erro ao buscar ficha técnica');
    } finally {
      setLoading(false);
    }
  };

  const listarAtivas = async () => {
    setLoading(true);
    setError(null);
    try {
      return await fichaTecnicaService.listarAtivas();
    } catch {
      setError('Erro ao listar fichas técnicas');
      return [];
    } finally {
      setLoading(false);
    }
  };

  return { ficha, loading, error, buscarPorCodigo, listarAtivas };
};
