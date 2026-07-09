// danfe.ts — normaliza os dados da NF-e (que o ClickNotas já devolve e nós
// guardamos em nfe_emitidas.gc_detail_response) num modelo pronto pra renderizar
// um DANFE dentro do sistema.
//
// Contexto: a API do ClickNotas NÃO expõe o PDF do DANFE nem o XML autorizado
// via endpoint próprio (probado exaustivamente — ver supabase/functions/nfe-download).
// O único "gancho" oficial é a chave de acesso (44 dígitos → meudanfe.com.br).
// PORÉM o detalhe /notas_fiscais_produtos/{id} traz TODOS os campos necessários
// pra montar uma representação fiel do DANFE (emitente, destinatário, produtos,
// impostos, chave, protocolo). Esta lib extrai isso de forma defensiva, com
// fallback pras colunas tipadas de nfe_emitidas quando o detalhe não veio.

// Aceita o número como string ("442.80"), número ou vazio. Retorna number.
function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

export interface DanfeProduto {
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
}

export interface DanfeDuplicata {
  numero: string;
  vencimento: string;
  valor: number;
}

export interface DanfeModel {
  // identificação
  numero: string;
  serie: string;
  modelo: string;
  tipoOperacao: string;      // "0 - ENTRADA" | "1 - SAÍDA"
  naturezaOperacao: string;
  chave: string;
  protocolo: string;
  dataEmissao: string;       // dd/MM/yyyy HH:mm (pt-BR)
  ambiente: string;          // "Produção" | "Homologação"
  situacao: string;
  cfopPrincipal: string;
  // emitente
  emitente: {
    nome: string;
    fantasia: string;
    cnpj: string;
    ie: string;
    endereco: string;
    bairro: string;
    municipio: string;
    uf: string;
    cep: string;
    telefone: string;
  };
  // destinatário
  destinatario: {
    nome: string;
    documento: string;       // CNPJ ou CPF formatado
    ie: string;
    endereco: string;
    bairro: string;
    municipio: string;
    uf: string;
    cep: string;
    telefone: string;
    email: string;
  };
  // impostos / totais
  totais: {
    baseIcms: number;
    valorIcms: number;
    baseIcmsSt: number;
    valorIcmsSt: number;
    valorProdutos: number;
    valorFrete: number;
    valorSeguro: number;
    valorDesconto: number;
    valorOutros: number;
    valorIpi: number;
    valorTotal: number;
  };
  produtos: DanfeProduto[];
  duplicatas: DanfeDuplicata[];
  informacoesComplementares: string;
}

function formatDoc(cnpj: string, cpf: string): string {
  const d = (cnpj || cpf).replace(/\D/g, '');
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return cnpj || cpf || '';
}

function formatCep(cep: string): string {
  const d = str(cep).replace(/\D/g, '');
  if (d.length === 8) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return str(cep);
}

// data_emissao costuma vir "2026-06-07" e hora_emissao "14:32:00"; ou ISO já
// completo na coluna data_emissao. Normaliza pra exibição pt-BR.
function formatEmissao(data: string, hora: string): string {
  if (!data) return '';
  // se já é ISO com T, usa direto
  const isoCandidate = data.includes('T') ? data : (hora ? `${data}T${hora}` : data);
  const norm = /Z$|[+-]\d{2}:\d{2}$/.test(isoCandidate) ? isoCandidate : isoCandidate + '-03:00';
  const d = new Date(norm);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  // fallback: já está em dd/MM/yyyy?
  return hora ? `${data} ${hora}` : data;
}

/**
 * Monta o modelo do DANFE a partir de uma linha de nfe_emitidas.
 * Prefere os dados ricos de `gc_detail_response.data`; cai pras colunas
 * tipadas quando o detalhe não está disponível (ex.: NF importada via sync
 * antiga, ou ainda processando).
 */
export function buildDanfeModel(nfe: any): DanfeModel {
  const d = nfe?.gc_detail_response?.data || {};

  const tipoNf = str(d.tipo_nf);
  const tipoOperacao = tipoNf === '0'
    ? '0 - ENTRADA'
    : tipoNf === '1'
      ? '1 - SAÍDA'
      : (str(d.codigo_cfop).startsWith('5') || str(d.codigo_cfop).startsWith('6') ? '1 - SAÍDA' : '');

  const ambienteRaw = str(d.tipo_ambiente).toLowerCase();
  const ambiente = ambienteRaw.includes('produ') || ambienteRaw === '1'
    ? 'Produção'
    : ambienteRaw
      ? 'Homologação'
      : '';

  const produtosRaw: any[] = Array.isArray(d.produtos) ? d.produtos : [];
  const produtos: DanfeProduto[] = produtosRaw.map((p) => {
    const quantidade = num(p.quantidade);
    const valorUnitario = num(p.valor_venda ?? p.valor_unitario);
    return {
      codigo: str(p.codigo_produto || p.produto_id),
      descricao: str(p.nome_produto || p.descricao),
      ncm: str(p.NCM || p.ncm),
      cfop: str(p.cfop),
      unidade: str(p.unidade) || 'UN',
      quantidade,
      valorUnitario,
      valorTotal: num(p.valor_total) || quantidade * valorUnitario,
    };
  });

  const pagamentoRaw: any[] = Array.isArray(d.pagamento) ? d.pagamento : [];
  const duplicatas: DanfeDuplicata[] = pagamentoRaw
    .filter((p) => str(p.data_vencimento) || num(p.valor_pagamento) > 0)
    .map((p, i) => ({
      numero: str(p.numero_duplicata) || String(i + 1),
      vencimento: str(p.data_vencimento),
      valor: num(p.valor_pagamento),
    }));

  const enderecoEmit = [str(d.logradouro_emitente), str(d.numero_emitente), str(d.complemento_emitente)]
    .filter(Boolean).join(', ');
  const enderecoDest = [str(d.destinatario_logradouro), str(d.destinatario_numero), str(d.destinatario_complemento)]
    .filter(Boolean).join(', ');

  return {
    numero: str(d.numero_nf) || str(nfe?.numero),
    serie: str(d.serie) || str(nfe?.serie) || '1',
    modelo: str(d.modelo) || '55',
    tipoOperacao,
    naturezaOperacao: str(d.natureza_operacao),
    chave: str(d.chave) || str(nfe?.chave_acesso),
    protocolo: str(d.protocolo) || str(nfe?.protocolo),
    dataEmissao: formatEmissao(str(d.data_emissao), str(d.hora_emissao)) || formatEmissao(str(nfe?.data_emissao), ''),
    ambiente,
    situacao: str(d.situacao_nf) || str(nfe?.status),
    cfopPrincipal: str(d.codigo_cfop),
    emitente: {
      nome: str(d.nome_emitente),
      fantasia: str(d.fantasia_emitente),
      cnpj: formatDoc(str(d.cnpj_emitente) || str(nfe?.cnpj_emitente), str(d.cpf_emitente)),
      ie: str(d.ie_emitente),
      endereco: enderecoEmit,
      bairro: str(d.bairro_emitente),
      municipio: str(d.municipio_emitente),
      uf: str(d.uf_emitente),
      cep: formatCep(str(d.cep_emitente)),
      telefone: str(d.telefone_emitente),
    },
    destinatario: {
      nome: str(d.destinatario_nome) || str(nfe?.nome_destinatario),
      documento: formatDoc(str(d.destinatario_cnpj) || str(nfe?.cnpj_destinatario), str(d.destinatario_cpf)),
      ie: str(d.destinatario_ie),
      endereco: enderecoDest,
      bairro: str(d.destinatario_bairro),
      municipio: str(d.destinatario_municipio_nome),
      uf: str(d.destinatario_uf),
      cep: formatCep(str(d.destinatario_cep)),
      telefone: str(d.destinatario_telefone),
      email: str(d.destinatario_email),
    },
    totais: {
      baseIcms: num(d.base_icms),
      valorIcms: num(d.valor_icms),
      baseIcmsSt: num(d.base_icms_st),
      valorIcmsSt: num(d.valor_icms_st),
      valorProdutos: num(d.valor_produtos),
      valorFrete: num(d.valor_frete),
      valorSeguro: num(d.valor_seguro),
      valorDesconto: num(d.valor_desconto),
      valorOutros: num(d.valor_outros),
      valorIpi: num(d.valor_ipi),
      valorTotal: num(d.valor_total_nf) || num(nfe?.valor_total),
    },
    produtos,
    duplicatas,
    informacoesComplementares: str(d.informacoes_complementares),
  };
}

/** true quando há dados ricos suficientes pra montar o DANFE completo. */
export function hasDanfeData(nfe: any): boolean {
  const prods = nfe?.gc_detail_response?.data?.produtos;
  return Array.isArray(prods) && prods.length > 0;
}

export function brl(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function qtyFmt(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}
