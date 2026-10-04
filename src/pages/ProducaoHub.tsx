import { HubLanding } from '@/components/layout/HubLanding';

export default function ProducaoHub() {
  return (
    <HubLanding
      hubPath="/producao"
      sectionLabel="Produção"
      description="Sequência oficial de entrada, planejamento, kanban e apontamento."
      hints={{
        '/producao/sequencia': 'Ordem oficial — fechar PV, cor e referência',
        '/producao/planejamento': 'Carga diária por setor',
        '/producao/antecipacao': 'Adiantar demanda futura',
        '/producao/corte-lookahead': 'Liberar Corte e fechar PV',
        '/producao/kanban': 'Quadro de gestão',
        '/producao/estouro': 'OPs acima da capacidade',
        '/producao/apontamento': 'Lançar produção por setor',
        '/producao/calculadora-grade': 'Montar grade de pares',
        '/imprimir-fichas': 'Fichas de operador',
        '/producao/analises': 'Lead time, OEE e qualidade',
      }}
    />
  );
}
