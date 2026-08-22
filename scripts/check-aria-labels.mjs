#!/usr/bin/env node
/**
 * Guard de nome acessível em botão só-ícone — roda dentro de `bun run build`.
 *
 * Um `<Button size="icon">` não tem texto visível: o rótulo dele é o ícone. Sem
 * `aria-label` (ou equivalente), leitor de tela anuncia só "botão", e quem chega
 * novo na tela também não descobre a ação sem clicar pra ver o que acontece.
 *
 * Medido em 10/08/2026: **151 de 249** botões só-ícone (61%) sem nome acessível,
 * espalhados por 79 arquivos.
 *
 * NOME ACESSÍVEL VÁLIDO — qualquer um destes conta:
 *   - `aria-label="Excluir ficha"`     (o mais direto)
 *   - `aria-labelledby="id-do-texto"`
 *   - `title="Excluir ficha"`          (também vira tooltip nativo)
 *   - `<span className="sr-only">Excluir ficha</span>` dentro do botão
 *     — é o padrão do shadcn e já é usado em 35 arquivos do projeto, então
 *     ignorá-lo geraria falso positivo em cima de código que está CERTO.
 *
 * BASELINE — mesma estratégia de `check-navigation-access.mjs` e
 * `check-design-tokens.sh`: este script roda no `build`, e o pipeline publica em
 * produção a cada push em `main`. Falha dura de cara derrubaria o deploy antes de
 * existir qualquer correção. Então a dívida atual fica congelada por ARQUIVO em
 * `scripts/aria-labels-baseline.txt`; o build só falha em violação **nova** —
 * arquivo novo, ou arquivo conhecido que PIOROU.
 *
 * Cada correção deve DIMINUIR os números. Quando zerar, apague o baseline — aí o
 * guard vira falha dura sozinho, sem precisar editar este arquivo.
 *
 * Uso:
 *   bun scripts/check-aria-labels.mjs                   # verifica (exit 1 se piorou)
 *   bun scripts/check-aria-labels.mjs --update-baseline # regrava a dívida
 *   bun scripts/check-aria-labels.mjs --list            # lista tudo, sem cobrar
 *
 * ⚠ Este script NÃO julga a QUALIDADE do rótulo. `aria-label="botão"` passa. O
 *   rótulo tem que dizer a AÇÃO em pt-BR ("Excluir ficha", "Abrir filtros"), não
 *   descrever o ícone ("Ícone de lixeira"). Isso é revisão humana.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASELINE_FILE = resolve(ROOT, 'scripts/aria-labels-baseline.txt');

const SCAN_DIRS = ['src/pages', 'src/components'];

/**
 * Isenções. Diferente do check de tokens, aqui a lista é curta de propósito:
 * layout de impressão não tem interação, então não costuma ter botão só-ícone.
 * `ui/sidebar` e `ui/carousel` são primitives do shadcn que já resolvem o nome
 * acessível por `sr-only` interno — ficam de fora só pra não depender do parser
 * acertar o aninhamento deles.
 */
const EXEMPT = /ui\/(sidebar|carousel)\.tsx$/;

// ── varredura de arquivos ────────────────────────────────────────────────────
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Acha o fim do elemento para poder olhar os filhos (onde mora o `sr-only`).
 *
 * Conta abertura/fechamento da MESMA tag pra não parar num `</Button>` de um
 * botão aninhado. Não é um parser de JSX de verdade — é heurística deliberada:
 * o custo de um parser aqui não se paga, e o modo de falha (achar o fechamento
 * cedo demais) só produziria falso POSITIVO, que o baseline absorve.
 */
function findChildren(src, tagName, openEnd) {
  const openRe = new RegExp(`<${tagName}\\b`, 'g');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'g');
  openRe.lastIndex = openEnd;
  closeRe.lastIndex = openEnd;

  let depth = 1;
  let cursor = openEnd;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(src);
    const nextClose = closeRe.exec(src);
    if (!nextClose) return src.slice(openEnd, openEnd + 600); // fallback: janela fixa
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + 1;
    } else {
      depth--;
      cursor = nextClose.index + 1;
      if (depth === 0) return src.slice(openEnd, nextClose.index);
    }
  }
  return '';
}

const HAS_NAME = /\baria-label\s*=|\baria-labelledby\s*=|\btitle\s*=/;

/**
 * Devolve a tag de abertura INTEIRA a partir do fim do nome da tag.
 *
 * Existe porque a versão anterior usava `[^>]*?` e parava no primeiro `>` — que
 * numa tag JSX quase nunca é o fim da tag: `onClick={() => x()}` tem um `>`
 * dentro da arrow function. Todo atributo escrito DEPOIS de um handler assim
 * ficava fora da janela, então um botão corretamente rotulado era acusado de
 * não ter nome acessível (caso `OrderPhotosDialog.tsx`, 22/08/2026 — o
 * `aria-label` vinha depois do `onClick` e o build de produção caiu).
 *
 * Varre caractere a caractere ignorando `>` dentro de string ('", crase) e
 * dentro de `{}`; o fim é o primeiro `>` em profundidade zero.
 */
function readOpeningTag(src, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; continue; }
    if (c === '>' && depth === 0) {
      const selfClosing = src[i - 1] === '/' ? '/' : '';
      return { attrs: src.slice(from, selfClosing ? i - 1 : i), selfClosing, end: i + 1 };
    }
  }
  return null;
}

function scanFile(file) {
  const src = readFileSync(file, 'utf8');
  const hits = [];
  let total = 0;

  // pega a tag de abertura inteira, mesmo quebrada em várias linhas
  const re = /<(Button|button)\b/g;
  for (const m of src.matchAll(re)) {
    const tagName = m[1];
    const span = readOpeningTag(src, m.index + m[0].length);
    if (!span) continue;
    const { attrs, selfClosing, end } = span;
    const full = src.slice(m.index, end);
    if (!/size\s*=\s*["']icon["']/.test(attrs)) continue;
    total++;

    if (HAS_NAME.test(attrs)) continue;

    // sem atributo de nome: o `sr-only` nos filhos ainda salva
    if (!selfClosing) {
      const children = findChildren(src, tagName, m.index + full.length);
      if (/sr-only/.test(children)) continue;
    }

    hits.push(src.slice(0, m.index).split('\n').length);
  }
  return { total, hits };
}

// ── execução ─────────────────────────────────────────────────────────────────
const files = SCAN_DIRS.flatMap((d) => walk(resolve(ROOT, d))).filter((f) => !EXEMPT.test(f));

let grandTotal = 0;
let grandNamed = 0;
const current = new Map(); // arquivo relativo → nº de violações
const detail = new Map(); // arquivo relativo → [linhas]

for (const file of files) {
  const { total, hits } = scanFile(file);
  grandTotal += total;
  grandNamed += total - hits.length;
  if (hits.length) {
    const rel = relative(ROOT, file);
    current.set(rel, hits.length);
    detail.set(rel, hits);
  }
}

const totalViolations = [...current.values()].reduce((a, b) => a + b, 0);

// ── modo --list ──────────────────────────────────────────────────────────────
if (process.argv.includes('--list')) {
  const sorted = [...current.entries()].sort((a, b) => b[1] - a[1]);
  for (const [file, count] of sorted) {
    console.log(`${String(count).padStart(3)}  ${file}`);
    console.log(`     linhas: ${detail.get(file).join(', ')}`);
  }
  console.log(`\n${totalViolations} de ${grandTotal} botões só-ícone sem nome acessível.`);
  process.exit(0);
}

// ── modo --update-baseline ───────────────────────────────────────────────────
if (process.argv.includes('--update-baseline')) {
  const sorted = [...current.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const body = sorted.map(([file, count]) => `${count}\t${file}`).join('\n');
  writeFileSync(
    BASELINE_FILE,
    [
      '# Botões `size="icon"` sem nome acessível, congelados por arquivo (contagem<TAB>arquivo).',
      '# Gerado por: bun scripts/check-aria-labels.mjs --update-baseline',
      '# O build falha se um arquivo novo aparecer ou um conhecido piorar.',
      '# Cada correção deve DIMINUIR estes números. Quando zerar, apague o arquivo.',
      body,
      '',
    ].join('\n'),
    'utf8',
  );
  console.log(`✅ Baseline regravado: ${totalViolations} violações em ${current.size} arquivos.`);
  process.exit(0);
}

// ── verificação contra o baseline ────────────────────────────────────────────
const baseline = new Map();
if (existsSync(BASELINE_FILE)) {
  for (const line of readFileSync(BASELINE_FILE, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [count, file] = line.split('\t');
    if (file) baseline.set(file.trim(), Number(count));
  }
}

const regressions = [];
let improved = 0;

for (const [file, count] of current) {
  const known = baseline.get(file);
  if (known === undefined) {
    regressions.push(`  ❌ ARQUIVO NOVO com botão sem nome: ${file} (${count})`);
  } else if (count > known) {
    regressions.push(`  ❌ PIOROU: ${file} — era ${known}, agora ${count}`);
  } else if (count < known) {
    improved++;
  }
}
for (const [file, known] of baseline) {
  if (!current.has(file)) improved++;
}

const pct = grandTotal ? Math.round((totalViolations / grandTotal) * 100) : 0;
console.log('');
console.log(`♿ Nome acessível em botão só-ícone`);
console.log(`   ${grandNamed} de ${grandTotal} com nome · ${totalViolations} sem (${pct}%)`);
console.log('');

if (regressions.length) {
  console.log('━'.repeat(56));
  console.log(regressions.join('\n'));
  console.log('');
  console.log('  Um `<Button size="icon">` precisa de nome acessível. Use:');
  console.log('    <Button size="icon" aria-label="Excluir ficha">   ← a AÇÃO, em pt-BR');
  console.log('  Não descreva o ícone ("Ícone de lixeira") — descreva o que acontece.');
  console.log('');
  console.log('  Se for intencional, rode:');
  console.log('    bun scripts/check-aria-labels.mjs --update-baseline');
  console.log('');
  process.exit(1);
}

if (improved > 0) {
  console.log(`   💡 ${improved} arquivo(s) melhoraram desde o baseline.`);
  console.log(`      Rode --update-baseline pra travar o ganho.`);
  console.log('');
}

console.log('   ✅ Nenhum botão sem nome NOVO (o restante é dívida no baseline).');
console.log('');
process.exit(0);
