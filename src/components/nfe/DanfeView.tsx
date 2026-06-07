import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { BarcodeSVG } from '@/components/ui/barcode-svg';
import { type DanfeModel, brl, qtyFmt } from '@/lib/danfe';

// DanfeView — representação visual do DANFE renderizada DENTRO do sistema, a
// partir dos dados que o GestaoClick devolve (gc_detail_response). NÃO é o PDF
// oficial da SEFAZ (esse só sai pela chave no meudanfe.com.br / painel GC), mas
// é uma reprodução fiel pra conferência, visualização e impressão/PDF local.
//
// REGRA DE PRINT (CLAUDE.md): componente de impressão usa INLINE STYLES + cores
// HARDCODED (#000), nunca tokens/primitives shadcn — garante render previsível
// em papel A4 independente do design system das telas.

const FONT = "'Inter Tight', Inter, Arial, sans-serif";
const BORDER = '1px solid #000';

const box: CSSProperties = {
  border: BORDER,
  padding: '3px 5px',
  boxSizing: 'border-box',
};
const label: CSSProperties = {
  fontSize: '6.5px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#000',
  lineHeight: 1.1,
  marginBottom: '1px',
};
const value: CSSProperties = {
  fontSize: '9px',
  fontWeight: 600,
  color: '#000',
  lineHeight: 1.2,
};
const th: CSSProperties = {
  border: BORDER,
  padding: '2px 3px',
  fontSize: '6.5px',
  textTransform: 'uppercase',
  fontWeight: 700,
  background: '#eee',
  textAlign: 'left',
};
const td: CSSProperties = {
  border: BORDER,
  padding: '2px 3px',
  fontSize: '8px',
  color: '#000',
  verticalAlign: 'top',
};

function Field({ l, v, style }: { l: string; v: string; style?: CSSProperties }) {
  return (
    <div style={{ ...box, ...style }}>
      <div style={label}>{l}</div>
      <div style={value}>{v || ' '}</div>
    </div>
  );
}

interface Props {
  model: DanfeModel;
}

export const DanfeView = forwardRef<HTMLDivElement, Props>(function DanfeView({ model }, ref) {
  const m = model;
  return (
    <div
      ref={ref}
      style={{
        width: '210mm',
        maxWidth: '100%',
        margin: '0 auto',
        background: '#fff',
        color: '#000',
        fontFamily: FONT,
        padding: '6mm',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Cabeçalho: emitente | DANFE | chave/barcode ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1.3fr', gap: 0, alignItems: 'stretch' }}>
        {/* Emitente */}
        <div style={{ ...box, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: '12px', fontWeight: 800, lineHeight: 1.1, fontFamily: "'Anton', Impact, sans-serif" }}>
            {m.emitente.fantasia || m.emitente.nome || 'EMITENTE'}
          </div>
          {m.emitente.fantasia && m.emitente.nome && m.emitente.fantasia !== m.emitente.nome && (
            <div style={{ fontSize: '7.5px', marginTop: 1 }}>{m.emitente.nome}</div>
          )}
          <div style={{ fontSize: '7.5px', marginTop: 3, lineHeight: 1.3 }}>
            {m.emitente.endereco}<br />
            {[m.emitente.bairro, [m.emitente.municipio, m.emitente.uf].filter(Boolean).join('/')].filter(Boolean).join(' - ')}
            {m.emitente.cep ? ` - CEP ${m.emitente.cep}` : ''}<br />
            {m.emitente.cnpj ? `CNPJ ${m.emitente.cnpj}` : ''}{m.emitente.ie ? ` · IE ${m.emitente.ie}` : ''}
            {m.emitente.telefone ? ` · Tel ${m.emitente.telefone}` : ''}
          </div>
        </div>
        {/* Bloco DANFE */}
        <div style={{ ...box, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: '12px', fontWeight: 800, fontFamily: "'Anton', Impact, sans-serif" }}>DANFE</div>
          <div style={{ fontSize: '6px', lineHeight: 1.15, margin: '2px 0' }}>
            Documento Auxiliar da Nota Fiscal Eletrônica
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, fontSize: '8px', fontWeight: 700 }}>
            <span>{m.tipoOperacao.startsWith('0') ? '0' : '1'}</span>
          </div>
          <div style={{ fontSize: '6px' }}>0-ENTRADA / 1-SAÍDA</div>
          <div style={{ fontSize: '8.5px', fontWeight: 700, marginTop: 3 }}>
            Nº {m.numero || '—'}
          </div>
          <div style={{ fontSize: '8px' }}>Série {m.serie}</div>
        </div>
        {/* Chave + barcode */}
        <div style={{ ...box, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          {m.chave ? (
            <>
              <div style={{ width: '100%', textAlign: 'center' }}>
                <BarcodeSVG value={m.chave} height={34} width={1} displayValue={false} margin={0} format="CODE128" />
              </div>
              <div style={{ ...label, marginTop: 3, textAlign: 'center', width: '100%' }}>Chave de acesso</div>
              <div style={{ fontSize: '8px', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", textAlign: 'center', wordBreak: 'break-all', lineHeight: 1.3 }}>
                {m.chave.replace(/(.{4})/g, '$1 ').trim()}
              </div>
            </>
          ) : (
            <div style={{ fontSize: '8px', textAlign: 'center' }}>Chave de acesso indisponível</div>
          )}
        </div>
      </div>

      {/* ── Natureza / Protocolo ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.6fr', marginTop: '-1px' }}>
        <Field l="Natureza da operação" v={m.naturezaOperacao} />
        <Field l="Protocolo de autorização" v={m.protocolo} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', marginTop: '-1px' }}>
        <Field l="CFOP" v={m.cfopPrincipal} />
        <Field l="Modelo / Série" v={`${m.modelo} / ${m.serie}`} />
        <Field l="Emissão" v={m.dataEmissao} />
        <Field l="Ambiente" v={m.ambiente} />
      </div>

      {/* ── Destinatário ── */}
      <SectionTitle>Destinatário / Remetente</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1.2fr 1fr', marginTop: '-1px' }}>
        <Field l="Nome / Razão social" v={m.destinatario.nome} />
        <Field l="CNPJ / CPF" v={m.destinatario.documento} />
        <Field l="Inscrição estadual" v={m.destinatario.ie} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1.2fr 1fr', marginTop: '-1px' }}>
        <Field l="Endereço" v={m.destinatario.endereco} />
        <Field l="Bairro" v={m.destinatario.bairro} />
        <Field l="CEP" v={m.destinatario.cep} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 1.2fr 1.4fr', marginTop: '-1px' }}>
        <Field l="Município" v={m.destinatario.municipio} />
        <Field l="UF" v={m.destinatario.uf} />
        <Field l="Telefone" v={m.destinatario.telefone} />
        <Field l="E-mail" v={m.destinatario.email} />
      </div>

      {/* ── Totais / Impostos ── */}
      <SectionTitle>Cálculo do imposto</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginTop: '-1px' }}>
        <Field l="Base de cálculo ICMS" v={brl(m.totais.baseIcms)} />
        <Field l="Valor do ICMS" v={brl(m.totais.valorIcms)} />
        <Field l="Base ICMS ST" v={brl(m.totais.baseIcmsSt)} />
        <Field l="Valor ICMS ST" v={brl(m.totais.valorIcmsSt)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginTop: '-1px' }}>
        <Field l="Valor dos produtos" v={brl(m.totais.valorProdutos)} />
        <Field l="Valor do frete" v={brl(m.totais.valorFrete)} />
        <Field l="Desconto" v={brl(m.totais.valorDesconto)} />
        <Field l="Outras despesas" v={brl(m.totais.valorOutros)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', marginTop: '-1px' }}>
        <Field l="Valor do IPI" v={brl(m.totais.valorIpi)} />
        <Field l="Seguro" v={brl(m.totais.valorSeguro)} />
        <Field
          l="Valor total da nota"
          v={`R$ ${brl(m.totais.valorTotal)}`}
          style={{ background: '#eee' }}
        />
      </div>

      {/* ── Produtos ── */}
      <SectionTitle>Dados dos produtos / serviços</SectionTitle>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '-1px' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '12%' }}>Código</th>
            <th style={th}>Descrição</th>
            <th style={{ ...th, width: '9%' }}>NCM</th>
            <th style={{ ...th, width: '7%' }}>CFOP</th>
            <th style={{ ...th, width: '6%' }}>UN</th>
            <th style={{ ...th, width: '9%', textAlign: 'right' }}>Qtde</th>
            <th style={{ ...th, width: '11%', textAlign: 'right' }}>V. unit.</th>
            <th style={{ ...th, width: '12%', textAlign: 'right' }}>V. total</th>
          </tr>
        </thead>
        <tbody>
          {m.produtos.length === 0 ? (
            <tr><td style={{ ...td, textAlign: 'center' }} colSpan={8}>Sem itens detalhados</td></tr>
          ) : (
            m.produtos.map((p, i) => (
              <tr key={i}>
                <td style={{ ...td, fontFamily: "'JetBrains Mono', monospace", fontSize: '7px' }}>{p.codigo}</td>
                <td style={td}>{p.descricao}</td>
                <td style={td}>{p.ncm}</td>
                <td style={td}>{p.cfop}</td>
                <td style={td}>{p.unidade}</td>
                <td style={{ ...td, textAlign: 'right' }}>{qtyFmt(p.quantidade)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{brl(p.valorUnitario)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{brl(p.valorTotal)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* ── Duplicatas ── */}
      {m.duplicatas.length > 0 && (
        <>
          <SectionTitle>Faturas / Duplicatas</SectionTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '-1px' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: '20%' }}>Nº</th>
                <th style={{ ...th, width: '40%' }}>Vencimento</th>
                <th style={{ ...th, textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {m.duplicatas.map((dup, i) => (
                <tr key={i}>
                  <td style={td}>{dup.numero}</td>
                  <td style={td}>{dup.vencimento}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{brl(dup.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ── Informações complementares ── */}
      <SectionTitle>Dados adicionais</SectionTitle>
      <div style={{ ...box, minHeight: '40px', marginTop: '-1px', fontSize: '7.5px', lineHeight: 1.35, whiteSpace: 'pre-wrap' }}>
        {m.informacoesComplementares || ' '}
      </div>

      <div style={{ fontSize: '6px', color: '#000', marginTop: 4, textAlign: 'center' }}>
        Representação interna do DANFE gerada pelo sistema a partir dos dados da NF-e ·
        Documento fiscal oficial: consulte a chave de acesso na SEFAZ.
      </div>
    </div>
  );
});

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: '7px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      marginTop: 5,
      marginBottom: 1,
      color: '#000',
    }}>
      {children}
    </div>
  );
}

export default DanfeView;
