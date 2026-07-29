#!/usr/bin/env node
/**
 * Guard de navegação — roda dentro de `npm run build`.
 *
 * Duas camadas:
 *
 *  1. **Falha dura (sempre)** — toda rota declarada em `src/data/navigation.ts`
 *     precisa estar em `ROUTE_MODULE_MAP` (`src/hooks/useAccessControl.ts`).
 *     Sem isso o item de menu fica inacessível pra quem não é admin.
 *
 *  2. **Baseline (novo, 2026-07-29)** — as demais invariantes de arquitetura de
 *     informação (órfã, fantasma, menu apontando pra redirect, grupo estourado,
 *     módulo que nenhum perfil concede, BottomNav sem dono…) são cobradas contra
 *     `scripts/ia-baseline.json`. O build falha só em violação **nova**.
 *
 * Por que baseline em vez de falha direta: este script roda no `build`, e o
 * pipeline publica em produção a cada push. Ligar tudo de uma vez derrubaria o
 * deploy antes de existir qualquer correção. O baseline congela a dívida atual,
 * trava a regressão hoje, e encolhe a cada lote. Quando zerar, apagar o arquivo
 * — aí o guard vira falha dura sozinho.
 *
 * Uso:
 *   node scripts/check-navigation-access.mjs                  # verifica
 *   node scripts/check-navigation-access.mjs --update-baseline # regrava a dívida
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory } from './ia-inventory.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASELINE_FILE = resolve(ROOT, 'scripts/ia-baseline.json');

const NAV_FILE = resolve(ROOT, 'src/data/navigation.ts');
const ACCESS_FILE = resolve(ROOT, 'src/hooks/useAccessControl.ts');

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`❌ Não foi possível ler ${file}: ${err.message}`);
    process.exit(2);
  }
}

// ════════════════════════════════════════════════════════════════════════
// Camada 1 — falha dura: menu ↔ ROUTE_MODULE_MAP
// ════════════════════════════════════════════════════════════════════════

/** Extrai todas as ocorrências de path/to: '/algo' em navigation.ts */
function extractNavRoutes(src) {
  const routes = new Set();
  const reA = /\bpath\s*:\s*["']([^"']+)["']/g;
  const reB = /\bto\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = reA.exec(src)) !== null) {
    if (m[1].startsWith('/')) routes.add(m[1]);
  }
  while ((m = reB.exec(src)) !== null) {
    if (m[1].startsWith('/')) routes.add(m[1]);
  }
  return routes;
}

/** Extrai chaves do objeto ROUTE_MODULE_MAP em useAccessControl.ts */
function extractRouteMap(src) {
  const start = src.indexOf('ROUTE_MODULE_MAP');
  if (start < 0) {
    console.error('❌ ROUTE_MODULE_MAP não encontrado em useAccessControl.ts');
    process.exit(2);
  }
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) {
    console.error('❌ Não foi possível parsear o objeto ROUTE_MODULE_MAP.');
    process.exit(2);
  }
  const body = src.slice(open + 1, end);
  const routes = new Set();
  const re = /^\s*["']([^"']+)["']\s*:/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m[1].startsWith('/')) routes.add(m[1]);
  }
  return routes;
}

const navRoutes = extractNavRoutes(read(NAV_FILE));
const mapRoutes = extractRouteMap(read(ACCESS_FILE));
const unmapped = [...navRoutes].filter((r) => !mapRoutes.has(r)).sort();

if (unmapped.length > 0) {
  console.error('\n❌ Falha na validação de navegação ↔ controle de acesso\n');
  console.error('As seguintes rotas estão declaradas em src/data/navigation.ts');
  console.error('mas NÃO estão registradas em ROUTE_MODULE_MAP');
  console.error('(src/hooks/useAccessControl.ts) — ficarão inacessíveis para');
  console.error('usuários não-admin:\n');
  for (const r of unmapped) console.error(`  • ${r}`);
  console.error('\nAdicione cada rota acima ao ROUTE_MODULE_MAP com o módulo apropriado.\n');
  process.exit(1);
}

// ════════════════════════════════════════════════════════════════════════
// Camada 2 — invariantes de IA, cobradas contra o baseline
// ════════════════════════════════════════════════════════════════════════

const f = inventory.findings;

/**
 * Cada checagem vira uma lista de chaves estáveis. Chave estável = identidade
 * do problema, não o texto da mensagem — senão editar um rótulo "cria" uma
 * violação nova e o build quebra por nada.
 */
const CHECKS = [
  {
    id: 'orphan-route',
    titulo: 'Tela com rota viva e nenhuma entrada de navegação',
    dica: 'Cadastre em menuGroups ou secondaryRoutes, ou registre em EXEMPT_FROM_MENU (scripts/ia-inventory.mjs) explicando por que fica fora.',
    itens: f.orphanRoutes.map((o) => ({ key: o.path, txt: `${o.path} → ${o.component} (App.tsx:${o.line})` })),
  },
  {
    id: 'ghost-nav-entry',
    titulo: 'Entrada de navegação apontando pra rota que não existe',
    dica: 'A rota some do App.tsx e o item de menu fica clicando no vazio.',
    itens: f.ghostNavEntries.map((g) => ({ key: `${g.surface}:${g.path}`, txt: `${g.path} (${g.surface}) — "${g.label}"` })),
  },
  {
    id: 'nav-points-at-redirect',
    titulo: 'Item de menu apontando pra rota que é só redirect',
    dica: 'O menu deve apontar pro destino final; redirect no menu esconde o caminho real e quebra o estado ativo.',
    itens: f.navPointingAtRedirect.map((n) => ({ key: `${n.surface}:${n.path}`, txt: `${n.path} → ${n.redirectTo || '?'} (${n.surface})` })),
  },
  {
    id: 'bottomnav-without-owner',
    titulo: 'Item do BottomNav sem dono de menu',
    dica: 'resolveMenuOwner() só resolve itens de menuGroups. Sem dono, canAccessRoute nega em modo granular e a aba SOME no celular.',
    itens: f.bottomNavFindings.map((b) => ({ key: b.path, txt: `"${b.label}" → ${b.path}${b.isRedirectOnly ? ' (é redirect)' : ''}` })),
  },
  {
    id: 'duplicate-nav-path',
    titulo: 'Mesmo path em duas superfícies de navegação',
    dica: 'Aparece duas vezes no Cmd+K e confunde a resolução de dono.',
    itens: f.duplicateNavPaths.map((d) => ({ key: d.path, txt: `${d.path} em ${d.surfaces.join(' + ')}` })),
  },
  {
    id: 'duplicate-route-def',
    titulo: 'Rota declarada duas vezes no App.tsx',
    dica: 'O React Router usa a primeira; a segunda é código morto que ninguém alcança — e trocar a ordem muda o comportamento em silêncio.',
    itens: f.duplicateRouteDefs.map((d) => ({ key: d.path, txt: `${d.path} nas linhas ${d.lines.join(' e ')}` })),
  },
  {
    id: 'module-granted-to-nobody',
    titulo: 'Módulo referenciado em ROUTE_MODULE_MAP que nenhum perfil concede',
    dica: 'As rotas desse módulo viram admin-only sem ninguém perceber. Conceda a chave em ROLE_MODULES ou use a chave que já existe.',
    itens: f.modulesGrantedToNobody.map((m) => ({ key: m.module, txt: `"${m.module}" governa ${m.routes.length} rota(s): ${m.routes.slice(0, 3).join(', ')}${m.routes.length > 3 ? '…' : ''}` })),
  },
  {
    id: 'route-without-module',
    titulo: 'Rota sob o RouteGuard sem módulo em ROUTE_MODULE_MAP',
    dica: 'Desde 29/07/2026 `isRouteAllowed` é fail-closed: rota não classificada é NEGADA. Esquecer de classificar tranca o usuário pra fora em silêncio. Alias legado também conta — passa pelo guard antes de redirecionar; dê a ele o módulo do DESTINO.',
    itens: f.routesWithoutModule.map((r) => ({ key: r.path, txt: `${r.path} → ${r.isRedirect ? `redirect ${r.redirectTo || ''}` : r.component} (App.tsx:${r.line})` })),
  },
  {
    id: 'nav-without-menu-owner',
    titulo: 'Rota de navegação sem dono de menu (inacessível em modo granular)',
    dica: 'secondaryRoutes não entra em getAllMenuItems(), então não tem dono. Aparece na busca e nega no clique.',
    itens: f.navWithoutMenuOwner.map((n) => ({ key: n.path, txt: `${n.path} — "${n.label}" (${n.surface})` })),
  },
];

/** Estouro de grupo é numérico: o baseline guarda a contagem, não só o nome. */
const groupCounts = Object.fromEntries(f.groupOverflow.map((g) => [g.group, g.count]));
const GROUP_LIMIT = 5;

// ── baseline ────────────────────────────────────────────────────────────
const empty = { checks: {}, groupOverflow: {} };
const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  : empty;

if (process.argv.includes('--update-baseline')) {
  const next = {
    _comentario: 'Dívida de arquitetura de informação congelada. O build falha só em violação NOVA. Cada lote de correção deve DIMINUIR estas listas — regrave com --update-baseline. Quando tudo zerar, apague este arquivo: o guard vira falha dura sozinho.',
    _atualizadoEm: new Date().toISOString().slice(0, 10),
    checks: Object.fromEntries(CHECKS.map((c) => [c.id, c.itens.map((i) => i.key).sort()])),
    groupOverflow: groupCounts,
  };
  writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + '\n');
  const total = CHECKS.reduce((a, c) => a + c.itens.length, 0);
  console.log(`\n📌 Baseline regravado: ${total} violação(ões) conhecidas + ${Object.keys(groupCounts).length} grupo(s) acima de ${GROUP_LIMIT}.`);
  console.log(`   → scripts/ia-baseline.json\n`);
  process.exit(0);
}

// ── verificação ─────────────────────────────────────────────────────────
let novas = 0;
let conhecidas = 0;
let resolvidas = 0;
const linhas = [];

for (const c of CHECKS) {
  const base = new Set(baseline.checks?.[c.id] ?? []);
  const atual = new Set(c.itens.map((i) => i.key));
  const nova = c.itens.filter((i) => !base.has(i.key));
  const sumiram = [...base].filter((k) => !atual.has(k));

  conhecidas += c.itens.length - nova.length;
  novas += nova.length;
  resolvidas += sumiram.length;

  if (c.itens.length || sumiram.length) {
    linhas.push(`\n  ${nova.length ? '❌' : '·'} ${c.titulo} — ${c.itens.length}${nova.length ? ` (${nova.length} NOVA${nova.length > 1 ? 'S' : ''})` : ''}`);
    for (const i of nova) linhas.push(`      ❌ NOVA: ${i.txt}`);
    if (sumiram.length) linhas.push(`      ✅ ${sumiram.length} resolvida(s) desde o baseline`);
    if (nova.length) linhas.push(`      ↳ ${c.dica}`);
  }
}

// grupos acima do limite
const gNovos = [];
for (const [group, count] of Object.entries(groupCounts)) {
  const antes = baseline.groupOverflow?.[group];
  if (antes === undefined) gNovos.push(`${group} passou a ter ${count} itens (limite ${GROUP_LIMIT})`);
  else if (count > antes) gNovos.push(`${group} cresceu de ${antes} para ${count} itens (limite ${GROUP_LIMIT})`);
}
const gResolvidos = Object.keys(baseline.groupOverflow ?? {}).filter((g) => !groupCounts[g]);
if (Object.keys(groupCounts).length || gResolvidos.length) {
  linhas.push(`\n  ${gNovos.length ? '❌' : '·'} Grupo da sidebar acima de ${GROUP_LIMIT} itens — ${Object.keys(groupCounts).length}`);
  for (const g of gNovos) linhas.push(`      ❌ NOVO: ${g}`);
  if (gResolvidos.length) linhas.push(`      ✅ resolvido: ${gResolvidos.join(', ')}`);
  if (gNovos.length) linhas.push('      ↳ Sidebar é ponto de entrada, não catálogo. Mova a sub-feature pra aba do hub ou pra secondaryRoutes.');
}
novas += gNovos.length;
resolvidas += gResolvidos.length;

console.log(`\n✅ Navegação ↔ acesso: ${navRoutes.size} rotas do menu, todas mapeadas em ROUTE_MODULE_MAP.`);
console.log(`\n📐 Arquitetura de informação — ${conhecidas} pendência(s) conhecida(s), ${novas} nova(s), ${resolvidas} resolvida(s).`);
if (linhas.length) console.log(linhas.join('\n'));

if (novas > 0) {
  console.error(`\n❌ ${novas} violação(ões) NOVA(S) de arquitetura de informação.\n`);
  console.error('   Corrija, ou — se for intencional — rode:');
  console.error('     node scripts/check-navigation-access.mjs --update-baseline\n');
  process.exit(1);
}

if (resolvidas > 0) {
  console.log(`\n💡 ${resolvidas} pendência(s) saíram desde o último baseline. Rode --update-baseline pra travar o ganho.`);
}
console.log('');
