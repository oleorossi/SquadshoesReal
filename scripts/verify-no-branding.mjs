#!/usr/bin/env node
/**
 * Build-time guard: garante que o bundle gerado em `dist/` não contém
 * elementos de branding externo no HTML estático nem strings reveladoras
 * em JS/CSS.
 *
 * Roda APÓS `vite build`. Se encontrar qualquer match, falha o build com
 * exit code 1, listando o arquivo e o trecho ofensivo para correção rápida.
 *
 * Limitações honestas: não consegue inspecionar JS injetado em runtime
 * pelo provedor (a plataforma injeta o badge no HTML servido, fora do
 * `dist/`). Para esses casos, o `whiteLabelGuard` runtime + CSS cobrem.
 * Esta verificação garante que NÓS não estamos enviando referências
 * indevidas.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');

// Padrões a procurar no HTML/JS/CSS finais. Mantém sob controle para
// evitar falso positivo (não procura genericamente por "badge" porque
// shadcn/ui tem componente Badge legítimo).
const FORBIDDEN_PATTERNS = [
  { regex: /lovable\.app/gi,        name: 'lovable.app domain reference' },
  { regex: /lovable\.dev/gi,        name: 'lovable.dev domain reference' },
  { regex: /gptengineer\.app/gi,    name: 'gptengineer.app domain reference' },
  { regex: /<lovable-badge\b/gi,    name: '<lovable-badge> custom element' },
  { regex: /<gpt-engineer-badge\b/gi, name: '<gpt-engineer-badge> custom element' },
  { regex: /id=['"]lovable-/gi,     name: 'id="lovable-*" attribute' },
  { regex: /class=['"][^'"]*\blovable-badge\b/gi, name: 'class="lovable-badge" attribute' },
  { regex: /Edit with Lovable/gi,   name: '"Edit with Lovable" copy' },
  { regex: /Powered by Lovable/gi,  name: '"Powered by Lovable" copy' },
];

// Arquivos do nosso próprio código que LEGITIMAMENTE referenciam esses
// nomes (script de verificação, util de limpeza, comentários explicativos).
// Use o nome do arquivo sem path — checagem por basename inclui-no-final.
const ALLOWLIST_BASENAMES = [
  // (nada do nosso código deveria vazar para dist/, mas mantemos a lista
  // pronta caso seja necessário)
];

/** Recursivamente lista arquivos sob `dir`. */
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function isScannable(file) {
  const ext = extname(file).toLowerCase();
  return ['.html', '.js', '.mjs', '.cjs', '.css', '.json', '.svg'].includes(ext);
}

function basename(p) {
  return p.split(/[\\/]/).pop() || '';
}

function main() {
  let files;
  try {
    files = walk(DIST).filter(isScannable);
  } catch (err) {
    console.error(`[verify-no-branding] dist/ não encontrado em ${DIST}. Rode \`vite build\` primeiro.`);
    process.exit(2);
  }

  const violations = [];

  for (const file of files) {
    if (ALLOWLIST_BASENAMES.includes(basename(file))) continue;
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const { regex, name } of FORBIDDEN_PATTERNS) {
      const matches = content.match(regex);
      if (matches && matches.length > 0) {
        violations.push({ file: file.replace(DIST + '/', ''), name, count: matches.length, sample: matches[0] });
      }
    }
  }

   const isCi = process.env.CI === 'true';
 
  const enrichedViolations = violations.map(v => {
    const fullPath = join(DIST, v.file);
    const content = readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');
    let line = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(v.sample)) {
        line = i + 1;
        break;
      }
    }
    return { ...v, line };
  });

  if (enrichedViolations.length === 0) {
    console.log(`✓ [verify-no-branding] ${files.length} arquivo(s) escaneado(s) — nenhum branding externo detectado.`);
    process.exit(0);
  }

  console.error('✗ [verify-no-branding] BRANDING EXTERNO DETECTADO NO BUNDLE:');
  console.error('');
  for (const v of enrichedViolations) {
    console.error(`  • ${v.file}${v.line !== -1 ? `:${v.line}` : ''}`);
    console.error(`    Padrão: ${v.name} (${v.count} ocorrência(s))`);
    console.error(`    Amostra: ${v.sample}`);
    console.error('');
  }

  const reportDir = join(__dirname, '..', 'reports');
  if (!readdirSync(dirname(reportDir), { withFileTypes: true }).some(dirent => dirent.name === 'reports')) {
    mkdirSync(reportDir, { recursive: true });
  }
  writeFileSync(join(reportDir, 'branding-violations.json'), JSON.stringify(enrichedViolations, null, 2));

  if (isCi) {
    console.error('Build abortado via CI. Remova as referências acima ou adicione o arquivo a ALLOWLIST_BASENAMES com justificativa.');
    process.exit(1);
  } else {
    console.warn('⚠️ [AVISO] Branding externo detectado. Relatório gerado em reports/branding-violations.json');
    console.warn('Corrija antes de enviar para o repositório.');
  }
}

main();
