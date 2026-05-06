// NF-e XML parser for Brazilian electronic invoices
export type ParsedNFeDuplicata = {
  number: string;
  dueDate: string;
  value: number;
};

export type ParsedNFe = {
  invoiceNumber: string;
  series: string;
  key: string;
  issueDate: string;
  totalValue: number;
  freightValue: number;
  discountValue: number;
  supplier: {
    name: string;
    tradeName: string;
    cnpj: string;
    ie: string;
    address: string;
    city: string;
    state: string;
    phone: string;
  };
  items: ParsedNFeItem[];
  duplicatas: ParsedNFeDuplicata[];
  paymentMethod: string;
};

export type ParsedNFeItem = {
  productCode: string;
  productName: string;
  ncm: string;
  cfop: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discount: number;
};

function getTextContent(el: Element | null, tag: string): string {
  if (!el) return '';
  const child = el.getElementsByTagName(tag)[0];
  return child?.textContent?.trim() || '';
}

function getNumber(el: Element | null, tag: string): number {
  const val = getTextContent(el, tag);
  return val ? parseFloat(val) : 0;
}

export function parseNFeXML(xmlString: string): ParsedNFe {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  // Handle namespace variants: NFe, nfeProc, NFeProc
  const nfe =
    doc.getElementsByTagName('NFe')[0] ||
    doc.getElementsByTagName('nfeProc')[0] ||
    doc.getElementsByTagName('NFeProc')[0] ||
    doc.documentElement;
  const infNFe = nfe.getElementsByTagName('infNFe')[0] || nfe;

  // Invoice identification
  const ide = infNFe.getElementsByTagName('ide')[0];
  const invoiceNumber = getTextContent(ide, 'nNF');
  const series = getTextContent(ide, 'serie');
  // dhEmi (datetime) is NF-e v3+; older v2 used dEmi (date only)
  const issueDate = (getTextContent(ide, 'dhEmi') || getTextContent(ide, 'dEmi')).slice(0, 10);

  // Key
  const key = infNFe?.getAttribute('Id')?.replace('NFe', '') || '';

  // Supplier (emitente)
  const emit = infNFe.getElementsByTagName('emit')[0];
  const enderEmit = emit?.getElementsByTagName('enderEmit')[0];

  const supplier = {
    name: getTextContent(emit, 'xNome'),
    tradeName: getTextContent(emit, 'xFant'),
    cnpj: getTextContent(emit, 'CNPJ'),
    ie: getTextContent(emit, 'IE'),
    address: [
      getTextContent(enderEmit, 'xLgr'),
      getTextContent(enderEmit, 'nro'),
      getTextContent(enderEmit, 'xBairro'),
    ].filter(Boolean).join(', '),
    city: getTextContent(enderEmit, 'xMun'),
    state: getTextContent(enderEmit, 'UF'),
    phone: getTextContent(enderEmit, 'fone'),
  };

  // Totals
  const total = infNFe.getElementsByTagName('total')[0];
  const icmsTot = total?.getElementsByTagName('ICMSTot')[0];
  const totalValue = getNumber(icmsTot, 'vNF');
  const freightValue = getNumber(icmsTot, 'vFrete');
  const discountValue = getNumber(icmsTot, 'vDesc');

  // Items
  const detElements = infNFe.getElementsByTagName('det');
  const items: ParsedNFeItem[] = [];

  for (let i = 0; i < detElements.length; i++) {
    const det = detElements[i];
    const prod = det.getElementsByTagName('prod')[0];
    if (!prod) continue;

    items.push({
      productCode: getTextContent(prod, 'cProd'),
      productName: getTextContent(prod, 'xProd'),
      ncm: getTextContent(prod, 'NCM'),
      cfop: getTextContent(prod, 'CFOP'),
      unit: getTextContent(prod, 'uCom'),
      quantity: getNumber(prod, 'qCom'),
      unitPrice: getNumber(prod, 'vUnCom'),
      totalPrice: getNumber(prod, 'vProd'),
      discount: getNumber(prod, 'vDesc'),
    });
  }

  // Duplicatas (boletos/parcelas)
  const cobranca = infNFe.getElementsByTagName('cobr')[0];
  const duplicatas: ParsedNFeDuplicata[] = [];
  if (cobranca) {
    const dups = cobranca.getElementsByTagName('dup');
    for (let i = 0; i < dups.length; i++) {
      duplicatas.push({
        number: getTextContent(dups[i], 'nDup'),
        dueDate: getTextContent(dups[i], 'dVenc'),
        value: getNumber(dups[i], 'vDup'),
      });
    }
  }

  // Payment method
  const pag = infNFe.getElementsByTagName('pag')[0];
  const detPag = pag?.getElementsByTagName('detPag')[0];
  const tPagCode = getTextContent(detPag, 'tPag');
  const paymentMap: Record<string, string> = {
    '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito',
    '04': 'Cartão de Débito', '05': 'Crédito Loja', '10': 'Vale Alimentação',
    '11': 'Vale Refeição', '12': 'Vale Presente', '13': 'Vale Combustível',
    '14': 'Duplicata Mercantil', '15': 'Boleto Bancário', '90': 'Sem Pagamento',
    '99': 'Outros',
  };
  const paymentMethod = paymentMap[tPagCode] || tPagCode || '';

  return {
    invoiceNumber,
    series,
    key,
    issueDate,
    totalValue,
    freightValue,
    discountValue,
    supplier,
    items,
    duplicatas,
    paymentMethod,
  };
}
