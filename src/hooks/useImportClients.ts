import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { invalidateAllClientQueries } from './useClients';

/**
 * Forma "normalizada" de um cliente extraído de arquivo, antes de ir pra DB.
 * Campos opcionais — IA/Excel podem não preencher todos.
 */
export interface ExtractedClient {
  razao_social: string;
  nome_fantasia?: string | null;
  cnpj?: string | null;
  inscricao_estadual?: string | null;
  regime_tributario?: string | null;
  endereco?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  email?: string | null;
  telefone?: string | null;
  contato?: string | null;
}

/** Apenas dígitos — pra dedup por CNPJ ignorando formatação. */
export const onlyDigits = (s: string | null | undefined): string =>
  (s ?? '').toString().replace(/\D/g, '');

/** Detecta o tipo de arquivo pela extensão + mime.
 *  'doc_legacy' = formato binário antigo .doc (Word 97-2003). Gemini Vision
 *  só aceita .docx (OOXML). Tratamos como 'unknown' pra dar mensagem clara
 *  de "salve como .docx" — antes mapeava silenciosamente pra docx e o
 *  Gemini retornava erro 400 confuso. */
type FileKind = 'excel' | 'csv' | 'pdf' | 'docx' | 'doc_legacy' | 'image' | 'unknown';

export function detectFileKind(file: File): FileKind {
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || mime.includes('spreadsheet') || mime.includes('excel')) return 'excel';
  if (name.endsWith('.csv') || mime.includes('csv')) return 'csv';
  if (name.endsWith('.pdf') || mime.includes('pdf')) return 'pdf';
  if (name.endsWith('.docx') || mime.includes('officedocument.wordprocessingml')) return 'docx';
  if (name.endsWith('.doc') || mime === 'application/msword') return 'doc_legacy';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp') || mime.startsWith('image/')) return 'image';
  return 'unknown';
}

/** Heurística de header pra mapeamento Excel/CSV — fuzzy match em PT-BR. */
const HEADER_ALIASES: Record<keyof ExtractedClient, string[]> = {
  razao_social: ['razao social', 'razão social', 'empresa', 'cliente', 'nome', 'lojista'],
  nome_fantasia: ['nome fantasia', 'fantasia', 'apelido', 'loja'],
  cnpj: ['cnpj', 'cpf/cnpj', 'cpf cnpj', 'documento'],
  inscricao_estadual: ['inscricao estadual', 'inscrição estadual', 'ie', 'i.e.', 'insc estadual'],
  regime_tributario: ['regime tributario', 'regime tributário', 'regime', 'tributacao'],
  endereco: ['endereco', 'endereço', 'logradouro', 'rua', 'avenida'],
  numero: ['numero', 'número', 'num', 'nº', 'n°'],
  bairro: ['bairro'],
  cidade: ['cidade', 'municipio', 'município'],
  estado: ['estado', 'uf', 'unidade federativa'],
  cep: ['cep', 'codigo postal', 'código postal', 'zip'],
  email: ['email', 'e-mail', 'correio'],
  telefone: ['telefone', 'fone', 'tel', 'celular', 'whatsapp'],
  contato: ['contato', 'responsavel', 'responsável', 'pessoa contato'],
};

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, '').trim();

/** Tenta achar a coluna do Excel/CSV pra um campo, via fuzzy match. */
function findHeaderIndex(headers: string[], field: keyof ExtractedClient): number {
  const aliases = HEADER_ALIASES[field].map(normalize);
  for (let i = 0; i < headers.length; i++) {
    const h = normalize(headers[i] || '');
    if (!h) continue;
    if (aliases.some(a => h === a || h.includes(a) || a.includes(h))) return i;
  }
  return -1;
}

/** Parse Excel/CSV local com SheetJS. */
export async function parseExcelOrCsv(file: File): Promise<ExtractedClient[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
  if (rows.length === 0) return [];

  // Detecta a linha de header — primeira que tem qualquer alias conhecido
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i] as any[];
    if (r.some((cell: any) => {
      const c = normalize(String(cell || ''));
      return Object.values(HEADER_ALIASES).some(aliases => aliases.some(a => c === normalize(a) || c.includes(normalize(a))));
    })) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = (rows[headerRowIdx] as any[]).map((h: any) => String(h ?? ''));
  const dataRows = rows.slice(headerRowIdx + 1);

  const fieldIndexes: Partial<Record<keyof ExtractedClient, number>> = {};
  (Object.keys(HEADER_ALIASES) as (keyof ExtractedClient)[]).forEach(field => {
    const idx = findHeaderIndex(headers, field);
    if (idx >= 0) fieldIndexes[field] = idx;
  });

  // Se não achou nem razao_social, abre mão — vai pelo manual
  if (fieldIndexes.razao_social === undefined && fieldIndexes.nome_fantasia === undefined) {
    throw new Error('Não consegui identificar colunas. Garanta que a planilha tenha cabeçalhos como "Razão Social", "CNPJ", "Cidade", etc.');
  }

  const extract = (row: any[], field: keyof ExtractedClient): string | null => {
    const idx = fieldIndexes[field];
    if (idx === undefined) return null;
    const val = row[idx];
    if (val === null || val === undefined || val === '') return null;
    return String(val).trim();
  };

  const clients: ExtractedClient[] = [];
  for (const row of dataRows) {
    const r = row as any[];
    const razao = extract(r, 'razao_social') || extract(r, 'nome_fantasia');
    if (!razao) continue;
    clients.push({
      razao_social: razao,
      nome_fantasia: extract(r, 'nome_fantasia'),
      cnpj: extract(r, 'cnpj'),
      inscricao_estadual: extract(r, 'inscricao_estadual'),
      regime_tributario: extract(r, 'regime_tributario'),
      endereco: extract(r, 'endereco'),
      numero: extract(r, 'numero'),
      bairro: extract(r, 'bairro'),
      cidade: extract(r, 'cidade'),
      estado: extract(r, 'estado'),
      cep: extract(r, 'cep'),
      email: extract(r, 'email'),
      telefone: extract(r, 'telefone'),
      contato: extract(r, 'contato'),
    });
  }
  return clients;
}

/** Lê arquivo como base64 (sem o prefixo data:...) pra mandar pra edge function. */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result = "data:<mime>;base64,<base64>"
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Roteia o parse: Excel/CSV local, resto vai pra Gemini via edge function. */
export async function extractClientsFromFile(file: File): Promise<ExtractedClient[]> {
  const kind = detectFileKind(file);
  if (kind === 'excel' || kind === 'csv') {
    return parseExcelOrCsv(file);
  }
  if (kind === 'unknown') {
    if (kind === 'doc_legacy') {
      throw new Error(
        `Formato .doc (Word 97-2003) não é suportado pelo extrator de IA. ` +
        `Abra "${file.name}" no Word/LibreOffice e salve como PDF, ou converta pra .docx — ` +
        `ou tire foto/screenshot e envie como imagem.`,
      );
    }
    throw new Error(`Formato não suportado: ${file.name}. Aceito: .xlsx, .xls, .csv, .pdf, .docx, .jpg, .png, .webp`);
  }

  // PDF/DOCX/Image → Gemini
  const sizeMb = file.size / (1024 * 1024);
  if (sizeMb > 18) {
    throw new Error(`Arquivo muito grande (${sizeMb.toFixed(1)}MB). Limite Gemini ~20MB. Reduza ou divida em partes.`);
  }

  const base64 = await fileToBase64(file);
  const { data, error } = await supabase.functions.invoke('extract-clients', {
    body: { fileBase64: base64, mimeType: file.type || guessMime(file.name), fileName: file.name },
  });

  if (error) {
    // supabase-js mascara erros não-2xx com "Edge Function returned a non-2xx status code".
    // A mensagem real do servidor vive em error.context.response — tenta JSON, depois texto bruto.
    let serverMsg: string | null = null;
    let httpStatus: number | null = null;
    try {
      const resp = (error as any)?.context?.response;
      if (resp && typeof resp.clone === 'function') {
        httpStatus = resp.status ?? null;
        try {
          const body = await resp.clone().json();
          serverMsg = body?.error || null;
        } catch {
          // Body não é JSON — pega texto puro como fallback
          try { serverMsg = (await resp.clone().text())?.slice(0, 300) || null; } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    // Dica específica pro 503 — quase sempre = chave Gemini não cadastrada
    const hint = httpStatus === 503
      ? ' (Provavelmente GEMINI_API_KEY não está cadastrada nos secrets do Supabase. Veja Supabase Dashboard → Edge Functions → Secrets. Pegue grátis em https://aistudio.google.com/app/apikey)'
      : '';
    throw new Error((serverMsg || error.message || 'Falha ao chamar extract-clients') + hint);
  }
  if (data?.error) throw new Error(data.error);
  return Array.isArray(data?.clients) ? data.clients : [];
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

/** Mutation pra criar OU atualizar 1 cliente. */
export function useSaveImportedClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      client,
      existingId,
      mode,
    }: {
      client: ExtractedClient;
      existingId?: string | null;
      mode: 'create' | 'update';
    }) => {
      // Sanitiza CNPJ pra só dígitos antes de salvar (consistência com o resto do sistema)
      const cnpjDigits = onlyDigits(client.cnpj);
      const payload: any = {
        razao_social: client.razao_social.trim(),
        nome_fantasia: client.nome_fantasia?.trim() || null,
        cnpj: cnpjDigits || null,
        inscricao_estadual: client.inscricao_estadual?.trim() || null,
        regime_tributario: client.regime_tributario?.trim() || null,
        endereco: client.endereco?.trim() || null,
        numero: client.numero?.trim() || null,
        bairro: client.bairro?.trim() || null,
        cidade: client.cidade?.trim() || null,
        estado: client.estado?.trim()?.toUpperCase()?.slice(0, 2) || null,
        cep: onlyDigits(client.cep) || null,
        email: client.email?.trim() || null,
        telefone: client.telefone?.trim() || null,
        contato: client.contato?.trim() || null,
      };

      if (mode === 'update' && existingId) {
        const { error } = await supabase.from('clients').update(payload).eq('id', existingId);
        if (error) throw error;
        return { id: existingId, action: 'updated' as const };
      }
      const { data, error } = await supabase.from('clients').insert({ ...payload, active: true }).select('id').single();
      if (error) throw error;
      return { id: (data as any).id, action: 'created' as const };
    },
    onSuccess: () => {
      invalidateAllClientQueries(qc);
    },
    onError: (err: Error) => {
      toast.error(`Falha ao salvar cliente: ${err.message}`);
    },
  });
}

/** Busca cliente existente pelo CNPJ (dígitos puros). null se não achou. */
export async function findExistingByCnpj(cnpj: string | null | undefined): Promise<{ id: string; razao_social: string } | null> {
  const digits = onlyDigits(cnpj);
  if (!digits) return null;
  const { data } = await supabase
    .from('clients')
    .select('id, razao_social, cnpj')
    .limit(20);
  if (!data) return null;
  // Match no client side pra ignorar formatação no DB também
  const hit = (data as any[]).find(c => onlyDigits(c.cnpj) === digits);
  return hit ? { id: hit.id, razao_social: hit.razao_social } : null;
}
