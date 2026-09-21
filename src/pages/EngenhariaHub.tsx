import { HubLanding } from '@/components/layout/HubLanding';

export default function EngenhariaHub() {
  return (
    <HubLanding
      hubPath="/engenharia"
      sectionLabel="Engenharia"
      description="Fichas, solados, silks e tiras artesanais — o projeto do calçado."
      hints={{
        '/fichas-tecnicas': 'Modelo, BOM e rota de produção',
        '/escalonamento': 'Grade e conversões de numeração',
        '/tiras-artesanais': 'Receitas, rendimento e estoque de tiras',
        '/solados': 'Specs e consumo por numeração',
        '/silks': 'Cadastro de silks e montagem',
      }}
    />
  );
}
