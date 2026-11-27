import { HubLanding } from '@/components/layout/HubLanding';

export default function EngenhariaHub() {
  return (
    <HubLanding
      hubPath="/engenharia"
      sectionLabel="Engenharia"
      description="Fichas, materiais base, solados, silks e tiras — o cadastro do que a fábrica produz."
      hints={{
        '/fichas-tecnicas': 'Catálogo publicado — modelo, BOM e rota',
        '/engenharia/fichas-rascunho': 'Referências em elaboração (ainda não publicadas)',
        '/engenharia/materiais-base': 'Kits e preços base por categoria',
        '/escalonamento': 'Grade e conversões de numeração',
        '/tiras-artesanais': 'Receitas, rendimento e estoque de tiras',
        '/solados': 'Specs e consumo por numeração',
        '/silks': 'Cadastro de silks e montagem',
      }}
    />
  );
}
