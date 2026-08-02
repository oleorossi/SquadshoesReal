import { formatCurrency } from '@/lib/utils';
import { formatDateBR } from '@/lib/dateOnly';
import { formatPayrollPeriod, paymentMethodLabel } from '@/hooks/usePayrollPayments';

/**
 * Recibo de pagamento de salário — documento A4 pra imprimir, colher a
 * assinatura do funcionário e escanear de volta (o scan sobe como comprovante
 * do pagamento). Abre em janela própria (window.open), sem primitives do app,
 * cores hardcoded e print-color-adjust — segue as regras de print do CLAUDE.md.
 */

const NOME_EMPRESA = 'SQUAD SHOES';

// ── valor por extenso (pt-BR) ────────────────────────────────────────
const UNI = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function tresDigitos(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  let s = c > 0 ? CEM[c] : '';
  if (resto > 0) {
    if (s) s += ' e ';
    if (resto < 20) s += UNI[resto];
    else {
      s += DEZ[Math.floor(resto / 10)];
      if (resto % 10 > 0) s += ' e ' + UNI[resto % 10];
    }
  }
  return s;
}

function inteiroExtenso(n: number): string {
  if (n === 0) return 'zero';
  const milhoes = Math.floor(n / 1_000_000) % 1000;
  const milhares = Math.floor(n / 1000) % 1000;
  const centenas = n % 1000;
  const parts: string[] = [];
  if (milhoes > 0) parts.push(tresDigitos(milhoes) + (milhoes === 1 ? ' milhão' : ' milhões'));
  if (milhares > 0) parts.push(milhares === 1 ? 'mil' : tresDigitos(milhares) + ' mil');
  if (centenas > 0) parts.push(tresDigitos(centenas));
  return parts.join(' e ');
}

/** "R$ 1.500,50" → "um mil e quinhentos reais e cinquenta centavos". */
export function valorPorExtenso(value: number): string {
  const reais = Math.floor(Math.round(value * 100) / 100);
  const centavos = Math.round((value - reais) * 100);
  const pReais = reais === 0 ? '' : `${inteiroExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`;
  const pCent = centavos === 0 ? '' : `${inteiroExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`;
  if (pReais && pCent) return `${pReais} e ${pCent}`;
  return pReais || pCent || 'zero real';
}

export interface PayrollReceiptData {
  employeeName: string;
  cpf?: string | null;
  role?: string | null;
  period: string;
  amount: number;
  paidOn: string;         // ISO YYYY-MM-DD
  method: string;         // valor cru ('pix'...) — humanizado aqui
  reference?: string | null;
  liquido?: number | null;
  city?: string;
  /** Produção do período (só regime POR PAR). Quando presente, o recibo diz que
   *  o pagamento é por produção — não "salário" — e discrimina a base: dias
   *  produtivos e pares. É o que o funcionário assina; descrever como salário
   *  quem é pago por par descreveria errado o que está sendo quitado. */
  producao?: {
    diasProdutivos: number;
    paresMedio: number;
    paresDificil: number;
  } | null;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function printPayrollReceipt(d: PayrollReceiptData) {
  const periodo = formatPayrollPeriod(d.period);
  const extenso = valorPorExtenso(d.amount);
  const metodo = paymentMethodLabel(d.method);
  const dataPgto = formatDateBR(d.paidOn);
  const cidade = d.city || 'Nova Serrana';
  const refLinha = d.reference ? ` (ref.: ${esc(d.reference)})` : '';
  const prod = d.producao;
  const paresTot = prod ? prod.paresMedio + prod.paresDificil : 0;
  const nf = (n: number) => n.toLocaleString('pt-BR');
  // "salário" vs "produção por par": o que está sendo quitado muda o texto do
  // recibo, o título do documento e os campos da grade.
  const tituloDoc = prod ? 'Recibo de Pagamento por Produção' : 'Recibo de Pagamento de Salário';
  const naturezaTxt = prod
    ? `<b>pagamento por produção</b> (${nf(paresTot)} pares montados em ${nf(prod.diasProdutivos)} dia(s) produtivo(s))`
    : '<b>pagamento de salário</b>';
  const camposProducao = prod
    ? `<div><div class="k">Dias produtivos</div><div class="v">${nf(prod.diasProdutivos)}</div></div>`
      + `<div><div class="k">Pares produzidos</div><div class="v">${nf(paresTot)}`
      + (prod.paresDificil > 0 ? ` (${nf(prod.paresMedio)} méd + ${nf(prod.paresDificil)} dif)` : '')
      + `</div></div>`
    : '';

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(tituloDoc)} — ${esc(d.employeeName)}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body { font-family: Georgia, 'Times New Roman', serif; }
  .sheet { width: 190mm; margin: 0 auto; padding: 18mm 14mm; }
  .card { border: 1.5px solid #111; padding: 12mm 12mm 14mm; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
  .empresa { font-family: Arial, Helvetica, sans-serif; font-weight: 800; font-size: 15pt; letter-spacing: 1px; }
  .doc-meta { font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #333; text-align: right; line-height: 1.5; }
  .title { font-family: Arial, Helvetica, sans-serif; font-weight: 800; font-size: 13pt; text-transform: uppercase; letter-spacing: 2px; text-align: center; margin: 6px 0 16px; }
  .valor { display: inline-block; border: 1.5px solid #111; padding: 6px 16px; font-family: Arial, Helvetica, sans-serif; font-weight: 800; font-size: 15pt; }
  .corpo { font-size: 12pt; line-height: 1.9; text-align: justify; margin: 16px 0 6px; }
  .corpo b { font-weight: 700; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; margin: 18px 0 6px; }
  .grid .k { color: #555; text-transform: uppercase; font-size: 8pt; letter-spacing: .5px; }
  .grid .v { font-weight: 700; }
  .assinatura { margin-top: 46px; text-align: center; }
  .linha { border-top: 1px solid #111; width: 74%; margin: 0 auto 6px; }
  .assinatura .nome { font-family: Arial, Helvetica, sans-serif; font-weight: 700; font-size: 10.5pt; }
  .assinatura .cpf { font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #555; }
  .local { text-align: right; font-size: 10.5pt; margin-top: 22px; }
  .rodape { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #777; text-align: center; margin-top: 16px; border-top: 1px solid #ccc; padding-top: 6px; }
  @media print { .sheet { padding: 0; } @page { size: A4; margin: 12mm; } }
</style></head>
<body>
  <div class="sheet"><div class="card">
    <div class="head">
      <div class="empresa">${esc(NOME_EMPRESA)}</div>
      <div class="doc-meta">RECIBO Nº ____________<br>PERÍODO: ${esc(periodo).toUpperCase()}</div>
    </div>
    <div class="title">${esc(tituloDoc)}</div>
    <div style="text-align:center"><span class="valor">${formatCurrency(d.amount)}</span></div>
    <p class="corpo">
      Recebi de <b>${esc(NOME_EMPRESA)}</b> a importância de <b>${esc(extenso)}</b>
      (<b>${formatCurrency(d.amount)}</b>), referente ao ${naturezaTxt}
      do período de <b>${esc(periodo)}</b>, efetuado por <b>${esc(metodo)}</b>${refLinha},
      dando plena e geral quitação pelo valor recebido.
    </p>
    <div class="grid">
      <div><div class="k">Funcionário</div><div class="v">${esc(d.employeeName)}</div></div>
      <div><div class="k">CPF</div><div class="v">${esc(d.cpf || '—')}</div></div>
      ${d.role ? `<div><div class="k">Função</div><div class="v">${esc(d.role)}</div></div>` : ''}
      ${camposProducao}
      ${d.liquido != null ? `<div><div class="k">Líquido da folha</div><div class="v">${formatCurrency(d.liquido)}</div></div>` : ''}
    </div>
    <div class="local">${esc(cidade)}, ${dataPgto}.</div>
    <div class="assinatura">
      <div class="linha"></div>
      <div class="nome">${esc(d.employeeName)}</div>
      <div class="cpf">CPF: ${esc(d.cpf || '____________________')}</div>
    </div>
    <div class="rodape">Documento gerado eletronicamente • assine e digitalize para anexar como comprovante do pagamento</div>
  </div></div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 120); };</script>
</body></html>`;

  const w = window.open('', '_blank', 'width=880,height=1000');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
