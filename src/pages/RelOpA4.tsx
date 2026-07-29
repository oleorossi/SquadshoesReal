/**
 * Relatório de OP — A4 portrait.
 * Fechamento de Ordem de Produção: identificação + indicadores +
 * apontamento por etapa + consumo de materiais.
 *
 * Layout do handoff: `screen-relatorios.jsx → RelOP`
 *
 * Hoje usa mock; substituir por hook com `order_id` para puxar:
 *   - orders + sale_orders + technical_sheets (identificação)
 *   - order_stages (apontamento)
 *   - order_costs / order_consumption (consumo de materiais)
 */
import { useMemo } from 'react';
import { format } from 'date-fns';
import { PaperShell, A4Head, A4Foot, Sigs, PrintBar } from '@/components/reports/A4Layout';

export default function RelOpA4() {
  const today = format(new Date(), 'dd/MM/yyyy');

  const identificacao = useMemo(() => [
    ['Cliente',          'VIP Shoes Araruama'],
    ['Pedido',           'PV-2026-00097'],
    ['Pares planejados', '420'],
    ['Pares produzidos', '420 (100%)'],
    ['Refugo',           '6 pares (1,4%)'],
    ['Aberta em',        '02/05/2026'],
    ['Fechada em',       '08/05/2026'],
    ['Tempo total',      '5 dias úteis'],
  ], []);

  const indicadores = [
    { l: 'OEE OP',    v: '89%' },
    { l: 'FPY',       v: '96,4%' },
    { l: 'Tempo/par', v: '31 min' },
    { l: 'Custo/par', v: 'R$ 28,40' },
  ];

  const etapas: Array<[string, string, string, string, number, number, string]> = [
    ['CORTE',      'Cleber B.',  '02/05 08:00', '02/05 14:30', 420, 0, '6h30'],
    ['COSTURA',    'Marcia L.',  '02/05 14:00', '04/05 17:00', 420, 4, '24h00'],
    ['MONTAGEM',   'Daniela R.', '05/05 08:00', '06/05 12:00', 420, 1, '12h00'],
    ['ACABAMENTO', 'Sandra M.',  '06/05 13:00', '07/05 15:00', 420, 1, '10h00'],
    ['EMBALAGEM',  'Roseli P.',  '07/05 15:30', '08/05 11:30', 414, 0, '6h00'],
  ];

  const materiais: Array<[string, string, string, string, string]> = [
    ['Verniz adocicado', '134,4 dm²', '138,2 dm²', '+2,8%', 'R$ 207,30'],
    ['Pelica creme',     '100,8 dm²', '99,4 dm²',  '−1,4%', 'R$ 99,40'],
    ['TR solado',        '420 pares', '420 pares', '0%',    'R$ 2.856,00'],
    ['EVA palmilha',     '420 pares', '420 pares', '0%',    'R$ 378,00'],
    ['Linha · Cola',     '—',         '—',         '—',     'R$ 312,40'],
  ];

  return (
    <>
      <PrintBar title="OP-2847 · Relatório de fechamento" />
      <div className="mx-auto mb-4 max-w-4xl rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground print:hidden">
        <strong>Modelo em homologação.</strong> Este relatório contém dados de exemplo e não deve ser usado como documento da fábrica.
      </div>
      <PaperShell>
        {/* O aviso precisa estar na folha: o PDF circula sem a interface. */}
        <div style={{ marginBottom: 12, padding: '8px 10px', background: '#FFF3CD', border: '1px solid #8A5A00', color: '#3D2700', fontSize: 10, fontWeight: 700, lineHeight: 1.35 }}>
          MODELO EM HOMOLOGAÇÃO — contém dados de exemplo. Não usar como documento oficial, para decisão, assinatura ou circulação.
        </div>
        <A4Head title="Relatório de OP" num="OP-2847 · Mocassim Verona" sub="Produção · OP fechada" emittedAt={`Emitido ${today}`} />

        {/* Identificação + Indicadores */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 22 }}>
          <div>
            <div className="p-eyebrow">Identificação</div>
            <div className="p-display" style={{ fontSize: 30, marginTop: 4 }}>OP-2847</div>
            <div style={{ fontSize: 12, marginTop: 4, color: 'var(--p-mute)' }}>Mocassim Verona · Adocicado</div>
            <table className="p-tbl" style={{ marginTop: 12 }}>
              <tbody>
                {identificacao.map((r, i) => (
                  <tr key={i}>
                    <td style={{ width: 130, color: 'var(--p-mute)' }}>{r[0]}</td>
                    <td style={{ fontWeight: 600 }}>{r[1]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="p-eyebrow">Indicadores</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
              {indicadores.map((k, i) => (
                <div key={i} className="p-kpi">
                  <div className="lbl">{k.l}</div>
                  <div className="val">{k.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Apontamento por etapa */}
        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Apontamento por etapa</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 18 }}>
          <thead>
            <tr>
              <th>Etapa</th><th>Operador</th><th>Início</th><th>Fim</th>
              <th className="num">Pares</th><th className="num">Refugo</th><th className="num">Tempo</th>
            </tr>
          </thead>
          <tbody>
            {etapas.map((r, i) => (
              <tr key={i}>
                <td><span className="p-mono" style={{ fontWeight: 700, fontSize: 9.5, letterSpacing: '0.08em' }}>{r[0]}</span></td>
                <td>{r[1]}</td>
                <td className="p-mono" style={{ fontSize: 10 }}>{r[2]}</td>
                <td className="p-mono" style={{ fontSize: 10 }}>{r[3]}</td>
                <td className="num">{r[4]}</td>
                <td className="num" style={{ color: r[5] > 0 ? 'var(--p-red)' : 'inherit', fontWeight: 600 }}>{r[5]}</td>
                <td className="num">{r[6]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Materiais consumidos */}
        <div className="p-eyebrow" style={{ marginBottom: 6 }}>02 · Consumo de materiais</div>
        <table className="p-tbl">
          <thead>
            <tr>
              <th>Material</th><th className="num">Previsto</th><th className="num">Real</th>
              <th className="num">Variação</th><th className="num">Custo</th>
            </tr>
          </thead>
          <tbody>
            {materiais.map((r, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{r[0]}</td>
                <td className="num">{r[1]}</td>
                <td className="num">{r[2]}</td>
                <td className="num" style={{ color: r[3].startsWith('+') ? 'var(--p-red)' : 'inherit' }}>{r[3]}</td>
                <td className="num">{r[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Sigs labels={['Líder OP', 'PCP', 'Qualidade']} />
        <A4Foot doc="OP-2847 · Relatório de fechamento" page="1 de 1" generatedAt={today} />
      </PaperShell>
    </>
  );
}
