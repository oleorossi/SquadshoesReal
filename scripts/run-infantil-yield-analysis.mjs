#!/usr/bin/env node
/**
 * Runner live: lê fichas infantis 25–34 e imprime rendimento
 * traseiro → tiras da frente (grade ref. 480 pares).
 *
 * Uso:
 *   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/run-infantil-yield-analysis.mjs
 *   # opcional: SHEET_CODE=I701
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sheetCode = (process.env.SHEET_CODE || 'I701').trim();
const grade = {
  '25': 40, '26': 40, '27': 40, '28': 40, '29': 80,
  '30': 80, '31': 40, '32': 40, '33': 40, '34': 40,
};

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: sheets, error } = await supabase
  .from('technical_sheets')
  .select('id, code, name, shoe_category, sizes, has_straps, status_ficha, upper_consumption, upper_consumption_per_size, components_accessories, strap_colors')
  .or(`code.eq.${sheetCode},name.ilike.%${sheetCode}%`)
  .limit(5);

if (error) {
  console.error('query error', error);
  process.exit(1);
}
if (!sheets?.length) {
  // fallback: any Infantil with sizes covering 25-34
  const { data: infantil, error: e2 } = await supabase
    .from('technical_sheets')
    .select('id, code, name, shoe_category, sizes, has_straps, status_ficha, upper_consumption, upper_consumption_per_size, components_accessories, strap_colors')
    .ilike('shoe_category', '%Infantil%')
    .limit(50);
  if (e2) { console.error(e2); process.exit(1); }
  console.log(JSON.stringify({ mode: 'infantil_list', count: infantil?.length || 0, sheets: (infantil || []).map(s => ({
    code: s.code, name: s.name, sizes: s.sizes, has_straps: s.has_straps,
    accessories: s.components_accessories, straps: s.strap_colors,
  })) }, null, 2));
  process.exit(0);
}

const sheet = sheets[0];
console.log(JSON.stringify({
  mode: 'sheet',
  sheet: {
    id: sheet.id,
    code: sheet.code,
    name: sheet.name,
    shoe_category: sheet.shoe_category,
    sizes: sheet.sizes,
    has_straps: sheet.has_straps,
    status_ficha: sheet.status_ficha,
    upper_consumption: sheet.upper_consumption,
    upper_consumption_per_size: sheet.upper_consumption_per_size,
    components_accessories: sheet.components_accessories,
    strap_colors: sheet.strap_colors,
  },
  grade_ref: grade,
}, null, 2));
