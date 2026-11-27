import { HubLanding } from '@/components/layout/HubLanding';

export default function ProducaoHub() {
  return (
    <HubLanding
      hubPath="/producao"
      sectionLabel="Produção"
      description="Motor, central de produção, apontamento, ateliê e ferramentas do chão."
      hints={{
        '/motor': 'Ponto único: plano, sequência, compras, prazos, capacidade e equipe',
        '/producao/corte-lookahead': 'Liberar Corte e fechar PV',
        '/producao/kanban': 'Quadro da Central de Produção',
        '/producao/estouro': 'OPs acima da capacidade',
        '/producao/apontamento': 'Lançar produção por setor',
        '/producao/calculadora-grade': 'Montar grade de pares',
        '/imprimir-fichas': 'Fichas de operador',
        '/producao/analises': 'Lead time, OEE e qualidade',
      }}
    />
  );
}
