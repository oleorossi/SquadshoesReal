import { HubLanding } from '@/components/layout/HubLanding';

export default function ProducaoHub() {
  return (
    <HubLanding
      hubPath="/producao"
      sectionLabel="Produção"
      description="Planejamento, kanban, apontamento e análises do chão de fábrica."
      hints={{
        '/producao/planejamento': 'Ondas e liberação de OPs',
        '/producao/antecipacao': 'Adiantar demanda futura',
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
