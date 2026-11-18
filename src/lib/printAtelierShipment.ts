/**
 * Papel da remessa do Ateliê: o recibo da OS mais a ficha do operador
 * de cabedal, com a grade desta parte (numeração e P/M/G).
 */
import { supabase } from '@/integrations/supabase/client';
import { thumbUrl } from '@/lib/imageThumb';
import { resolveSheetFacas, type FacaBoundary, type KnifeBucket } from '@/lib/knifeFacas';
import { printServiceOrderReceipt, type ReceiptItem } from '@/lib/printServiceOrderReceipt';
import { gradeSizeKeys, gradeTotal, rollupGradeByFaca, type SizeGrade } from '@/lib/atelierSplit';
import { formatDateBR } from '@/lib/dateOnly';
import { formatCurrency } from '@/lib/utils';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function asGrade(value: unknown): SizeGrade {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: SizeGrade = {};
  for (const [key, qty] of Object.entries(value as Record<string, unknown>)) {
    const n = Math.trunc(Number(qty) || 0);
    if (n > 0) out[key] = n;
  }
  return out;
}

function firstImage(images: unknown, imageUrl: string | null): string | null {
  if (Array.isArray(images)) {
    const hit = images.find((item) => typeof item === 'string' && item);
    if (typeof hit === 'string') return hit;
  }
  return imageUrl || null;
}

function appendixHtml(input: {
  reference: string;
  color: string | null;
  variant: string | null;
  sector: string;
  notes: string | null;
  grade: SizeGrade;
  facas: { label: string; pairs: number }[];
  price: number | null;
  returnOn: string | null;
  pv: string | null;
}): string {
  const sizes = gradeSizeKeys(input.grade);
  const gradeRow = sizes.length === 0 ? '' : `
    <table class="grade">
      <thead><tr><th class="rowlbl">Nº</th>${sizes.map((size) => `<th>${esc(size === 'pares' ? 'Pares' : size)}</th>`).join('')}<th class="tot">TOT</th></tr></thead>
      <tbody><tr><td class="rowlbl">Qtd</td>${sizes.map((size) => `<td>${input.grade[size]}</td>`).join('')}<td class="tot">${gradeTotal(input.grade)}</td></tr></tbody>
    </table>`;
  const facaRow = input.facas.length === 0 ? '' : `
    <p class="faca">${input.facas.map((faca) => `<b>${esc(faca.label)}</b> ${faca.pairs}`).join(' · ')}</p>`;
  return `
    <section class="ficha">
      <div class="sectitle"><span>Ficha do operador de cabedal</span></div>
      <p>${esc(input.reference)}${input.color ? ` · ${esc(input.color)}` : ''}${input.variant ? ` · ${esc(input.variant)}` : ''}</p>
      <p>${esc(input.sector)}${input.pv ? ` · ${esc(input.pv)}` : ''}${input.returnOn ? ` · volta ${esc(formatDateBR(input.returnOn))}` : ''}${input.price != null ? ` · ${esc(formatCurrency(input.price))}/par` : ''}</p>
      ${input.notes ? `<p>Obs.: ${esc(input.notes)}</p>` : ''}
      ${facaRow}
      ${gradeRow || '<p>Grade por numeração não informada.</p>'}
    </section>`;
}

export async function printAtelierShipment(serviceOrderId: string) {
  const { data: order, error } = await supabase
    .from('service_orders')
    .select('id, order_number, description, service_date, quantity, notes, target_sector, contractor_id, quoted_deadline, sale_order_id')
    .eq('id', serviceOrderId)
    .single();
  if (error) throw error;

  const { data: lines, error: lineError } = await supabase
    .from('service_order_items' as never)
    .select('id, material_name, description, color, quantity, unit_price, atelier_job_id, atelier_part_id, sale_order_id')
    .eq('service_order_id', serviceOrderId);
  if (lineError) throw lineError;
  const lineRows = (lines ?? []) as Array<{
    material_name: string | null;
    description: string | null;
    color: string | null;
    quantity: number | null;
    unit_price: number | null;
    atelier_job_id: string | null;
    atelier_part_id: string | null;
    sale_order_id: string | null;
  }>;

  const partIds = lineRows.map((line) => line.atelier_part_id).filter(Boolean);
  const { data: parts } = partIds.length
    ? await supabase.from('atelier_job_parts' as never).select('id, grade, unit_price, return_on, job_id').in('id', partIds)
    : { data: [] as Array<Record<string, unknown>> };
  const partById = new Map((parts ?? []).map((part: {
    id: string;
    grade?: unknown;
    unit_price?: number | null;
    return_on?: string | null;
    job_id?: string;
  }) => [part.id, part]));

  const jobIds = lineRows.map((line) => line.atelier_job_id).filter(Boolean);
  const { data: jobs } = jobIds.length
    ? await supabase.from('cabedal_prep_jobs' as never).select('id, technical_sheet_id, sector, reference_code, color').in('id', jobIds)
    : { data: [] as Array<Record<string, unknown>> };
  const jobById = new Map((jobs ?? []).map((job: {
    id: string;
    technical_sheet_id?: string | null;
    sector?: string;
    reference_code?: string | null;
    color?: string | null;
  }) => [job.id, job]));
  const sheetIds = [...new Set((jobs ?? []).map((job: { technical_sheet_id?: string | null }) => job.technical_sheet_id).filter(Boolean))];
  const { data: sheets } = sheetIds.length
    ? await supabase.from('technical_sheets' as never).select('id, code, name, model, image_url, images, knife_size_ranges, description').in('id', sheetIds)
    : { data: [] as Array<Record<string, unknown>> };
  const sheetById = new Map((sheets ?? []).map((sheet: {
    id: string;
    code?: string | null;
    model?: string | null;
    image_url?: string | null;
    images?: unknown;
    knife_size_ranges?: unknown;
    description?: string | null;
  }) => [sheet.id, sheet]));

  const { data: knifeRow } = await supabase
    .from('system_settings' as never)
    .select('value')
    .eq('key', 'knife_facas_default')
    .maybeSingle();
  let boundaries: FacaBoundary[] | null = null;
  try {
    const knife = knifeRow as { value?: unknown } | null;
    const raw = typeof knife?.value === 'string' ? JSON.parse(knife.value) : knife?.value;
    if (Array.isArray(raw)) boundaries = raw as FacaBoundary[];
  } catch {
    boundaries = null;
  }

  const saleIds = [...new Set(lineRows.map((line) => line.sale_order_id).filter(Boolean))];
  const { data: sales } = saleIds.length
    ? await supabase.from('sale_orders').select('id, order_number').in('id', saleIds as string[])
    : { data: [] };
  const pvById = new Map((sales ?? []).map((sale) => [sale.id, sale.order_number]));

  const { data: contractor } = await supabase
    .from('contractors')
    .select('name, trade_name, cnpj_cpf, phone')
    .eq('id', order.contractor_id)
    .maybeSingle();

  const items: ReceiptItem[] = [];
  const sections: string[] = [];
  for (const line of lineRows) {
    const part = (line.atelier_part_id ? partById.get(line.atelier_part_id) : null) as {
      grade?: unknown;
      unit_price?: number | null;
      return_on?: string | null;
    } | null;
    const job = (line.atelier_job_id ? jobById.get(line.atelier_job_id) : null) as {
      technical_sheet_id?: string | null;
    } | null;
    const sheet = (job?.technical_sheet_id ? sheetById.get(job.technical_sheet_id) : null) as {
      code?: string | null;
      model?: string | null;
      image_url?: string | null;
      images?: unknown;
      knife_size_ranges?: unknown;
      description?: string | null;
    } | null;
    const grade = asGrade(part?.grade);
    const photo = sheet ? thumbUrl(firstImage(sheet.images, sheet.image_url), 240) : null;
    items.push({
      ref_code: line.material_name,
      ref_name: line.description,
      color: line.color,
      pairs: Number(line.quantity) || gradeTotal(grade),
      size_breakdown: gradeSizeKeys(grade).length ? grade : null,
      photo_url: photo ?? null,
    });
    const override = Array.isArray(sheet?.knife_size_ranges) ? sheet.knife_size_ranges as KnifeBucket[] : null;
    const buckets = resolveSheetFacas(override, boundaries, gradeSizeKeys(grade).filter((size) => size !== 'pares'));
    sections.push(appendixHtml({
      reference: sheet?.code || sheet?.model || line.material_name || 'Referência',
      color: line.color,
      variant: null,
      sector: order.target_sector === 'mesa' ? 'Aviamento' : 'Costura de cabedal',
      notes: sheet?.description ?? null,
      grade,
      facas: rollupGradeByFaca(grade, buckets),
      price: part?.unit_price != null ? Number(part.unit_price) : (line.unit_price != null ? Number(line.unit_price) : null),
      returnOn: part?.return_on ?? order.quoted_deadline,
      pv: line.sale_order_id ? pvById.get(line.sale_order_id) ?? null : null,
    }));
  }

  printServiceOrderReceipt(
    {
      id: order.id,
      order_number: order.order_number,
      description: order.description,
      service_date: order.service_date,
      quantity: Number(order.quantity) || 0,
      notes: order.notes,
      target_sector: order.target_sector,
      quoted_deadline: order.quoted_deadline,
    },
    contractor ?? undefined,
    { items, appendixHtml: sections.join('') },
  );
}

export async function printAtelierShipments(serviceOrderIds: readonly string[]) {
  for (const id of serviceOrderIds) {
    await printAtelierShipment(id);
  }
}
