import { getSignedUrl } from './getSignedUrl';

/**
 * Ficha Técnica imprimível (Ficha de Corte) — modelo industrial calçadista:
 * cabeçalho (LINHA/REFERENCIA/CORTE/CABEDAL/PESO/OBS) + foto + tabela
 * "MATERIAIS VARIAVEIS" (faca/peça) + itens fixos (aviamento). Gera um A4 num
 * window.open próprio (igual printLabels) — print usa inline styles + #000 puro
 * (regra de print do projeto).
 */

export interface FichaCorteRow {
  codigo_faca: string;
  peca: string;
  ref_faca: string;
  agrupamento: string;
  consumo: string;
}
export interface FichaCorteFixo {
  peca: string;
  quantidade: string;
}
export interface FichaCorteData {
  linha: string;
  referencia: string;
  corte: string;
  cabedal: string;
  peso: string;
  obs: string;
  materiais: FichaCorteRow[];
  fixos: FichaCorteFixo[];
}

export const emptyFichaRow = (): FichaCorteRow => ({ codigo_faca: '', peca: '', ref_faca: '', agrupamento: '', consumo: '' });
export const emptyFichaFixo = (): FichaCorteFixo => ({ peca: '', quantidade: '' });
export const emptyFichaCorte = (referencia = ''): FichaCorteData => ({
  linha: '', referencia, corte: '', cabedal: '', peso: '', obs: '', materiais: [], fixos: [],
});

/** Normaliza um valor possivelmente parcial (vindo do JSONB) num FichaCorteData. */
export function normalizeFichaCorte(raw: any, referenciaFallback = ''): FichaCorteData {
  const base = emptyFichaCorte(referenciaFallback);
  if (!raw || typeof raw !== 'object') return base;
  return {
    linha: String(raw.linha ?? ''),
    referencia: String(raw.referencia ?? referenciaFallback ?? ''),
    corte: String(raw.corte ?? ''),
    cabedal: String(raw.cabedal ?? ''),
    peso: String(raw.peso ?? ''),
    obs: String(raw.obs ?? ''),
    materiais: Array.isArray(raw.materiais) ? raw.materiais.map((r: any) => ({
      codigo_faca: String(r?.codigo_faca ?? ''),
      peca: String(r?.peca ?? ''),
      ref_faca: String(r?.ref_faca ?? ''),
      agrupamento: String(r?.agrupamento ?? ''),
      consumo: String(r?.consumo ?? ''),
    })) : [],
    fixos: Array.isArray(raw.fixos) ? raw.fixos.map((f: any) => ({
      peca: String(f?.peca ?? ''),
      quantidade: String(f?.quantidade ?? ''),
    })) : [],
  };
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function buildFichaTecnicaHtml(data: FichaCorteData, photoUrl: string | null, sheetName: string): string {
  const codeRow = (k: string, v: string) =>
    `<div class="crow"><span class="ck">${esc(k)}:</span><span class="cv">${esc(v)}</span></div>`;

  const matRows = (data.materiais.length > 0 ? data.materiais : [emptyFichaRow()]).map((r) => `
    <tr>
      <td class="c center">${esc(r.codigo_faca)}</td>
      <td class="c">${esc(r.peca)}</td>
      <td class="c center">${esc(r.ref_faca)}</td>
      <td class="c center">${esc(r.agrupamento)}</td>
      <td class="c center">${esc(r.consumo)}</td>
    </tr>`).join('');

  const fixoRows = data.fixos.filter(f => f.peca || f.quantidade).map((f) => `
    <tr>
      <td class="c" colspan="4">${esc(f.peca)}</td>
      <td class="c qty">${esc(f.quantidade)}</td>
    </tr>`).join('');

  const photoHtml = photoUrl
    ? `<img src="${esc(photoUrl)}" alt="" crossorigin="anonymous" onerror="this.style.display='none'" />`
    : `<div class="nophoto">SEM FOTO</div>`;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Ficha Técnica · ${esc(sheetName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #e8e6e1; font-family: Arial, Helvetica, sans-serif; color: #000; }
  body { padding: 16px; }
  @page { size: A4 portrait; margin: 10mm; }
  .sheet { width: 190mm; margin: 0 auto; background: #fff; border: 1.5px solid #000; }
  .title { text-align: center; font-weight: 800; font-size: 17px; letter-spacing: 2px; padding: 7px; border-bottom: 1.5px solid #000; }
  .head { display: flex; border-bottom: 1.5px solid #000; }
  .head-left { flex: 1.5; border-right: 1.5px solid #000; padding: 8px 10px; display: flex; flex-direction: column; }
  .obs { font-size: 11px; min-height: 22px; margin-bottom: 10px; }
  .obs b { font-weight: 700; }
  .codes { border: 1px solid #000; align-self: flex-start; }
  .crow { display: flex; border-bottom: 1px solid #000; }
  .crow:last-child { border-bottom: none; }
  .ck { padding: 3px 10px; border-right: 1px solid #000; font-weight: 700; font-size: 11px; min-width: 96px; }
  .cv { padding: 3px 12px; font-size: 11px; min-width: 90px; }
  .head-photo { flex: 1; display: flex; align-items: center; justify-content: center; padding: 8px; }
  .head-photo img { max-width: 100%; max-height: 180px; object-fit: contain; }
  .nophoto { font-size: 10px; color: #999; letter-spacing: 1px; }
  .band { text-align: center; font-weight: 800; font-size: 13px; letter-spacing: 1px; padding: 5px; border-bottom: 1.5px solid #000; background: #ececec; }
  table { width: 100%; border-collapse: collapse; }
  th, td.c { border: 1px solid #000; font-size: 10.5px; padding: 3px 6px; vertical-align: middle; }
  thead th { font-weight: 800; text-align: center; background: #f4f4f4; text-transform: uppercase; font-size: 10px; letter-spacing: 0.3px; }
  td.c { text-align: left; }
  td.center { text-align: center; }
  td.qty { text-align: right; font-weight: 700; width: 130px; }
  .col-cod { width: 70px; } .col-ref { width: 70px; } .col-agr { width: 150px; } .col-cons { width: 80px; }
  .print-bar { max-width: 190mm; margin: 14px auto 0; text-align: center; }
  .print-bar button { font: inherit; font-size: 12px; font-weight: 600; padding: 9px 22px; border-radius: 4px; cursor: pointer; border: 0; }
  .print-bar .go { background: #0f172a; color: #fff; }
  .print-bar .close { background: #fff; color: #0f172a; border: 1px solid #0f172a; margin-left: 8px; }
  @media print { body { background: #fff; padding: 0; } .sheet { border: 1.5px solid #000; width: auto; } .print-bar { display: none; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
  <div class="sheet">
    <div class="title">FICHA TÉCNICA</div>
    <div class="head">
      <div class="head-left">
        <div class="obs"><b>OBS:</b> ${esc(data.obs)}</div>
        <div class="codes">
          ${codeRow('LINHA', data.linha)}
          ${codeRow('REFERENCIA', data.referencia)}
          ${codeRow('CORTE', data.corte)}
          ${codeRow('CABEDAL', data.cabedal)}
          ${codeRow('PESO', data.peso)}
        </div>
      </div>
      <div class="head-photo">${photoHtml}</div>
    </div>
    <div class="band">MATERIAIS VARIAVEIS</div>
    <table>
      <thead><tr>
        <th class="col-cod">Codigo Faca</th><th>Peça</th><th class="col-ref">Ref Faca</th><th class="col-agr">Agrupamento Faca</th><th class="col-cons">Consumo</th>
      </tr></thead>
      <tbody>${matRows}${fixoRows}</tbody>
    </table>
  </div>
  <div class="print-bar">
    <button class="go" onclick="window.print()">Imprimir / Salvar PDF</button>
    <button class="close" onclick="window.close()">Fechar</button>
  </div>
</body></html>`;
}

export async function printFichaTecnica(data: FichaCorteData, photoSrc: string | null | undefined, sheetName: string): Promise<void> {
  const photoUrl = photoSrc ? await getSignedUrl(photoSrc) : null;
  const html = buildFichaTecnicaHtml(data, photoUrl, sheetName);
  const w = window.open('', '_blank');
  if (!w) { alert('Permita pop-ups para gerar a ficha imprimível.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
