#!/usr/bin/env node
/**
 * Inventário mecânico da Arquitetura de Informação (menus, rotas, abas, perfis).
 *
 * Read-only: não altera nada. Emite `docs/ia-inventory.json` + um resumo no
 * stdout. Serve de três coisas:
 *   1. insumo factual pra auditoria (o auditor não precisa recontar à mão);
 *   2. retrato "ANTES" do artifact de aprovação;
 *   3. base dos guards de CI (a lógica de órfã/fantasma/estouro nasce aqui e
 *      depois vira falha de build em `check-navigation-access.mjs`).
 *
 * Uso: node scripts/ia-inventory.mjs [--json] [--out <arquivo>]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => resolve(ROOT, ...s);
const read = (f) => readFileSync(f, 'utf8');

// ════════════════════════════════════════════════════════════════════════
// 1. Rotas — src/App.tsx
// ════════════════════════════════════════════════════════════════════════

/**
 * Substitui o valor de `element:` / `errorElement:` pelo nome do componente
 * entre aspas. Sem isso as chaves do JSX corrompem a pilha de escopo usada
 * pra reconstruir o caminho completo das rotas aninhadas.
 */
function maskElements(src) {
  const out = [];
  let i = 0;
  const KEY = /\b(errorElement|element|lazy)\s*:\s*/g;
  KEY.lastIndex = 0;
  let m;
  while ((m = KEY.exec(src)) !== null) {
    if (m.index < i) continue;
    out.push(src.slice(i, m.index));
    let j = KEY.lastIndex;
    let end;
    if (m[1] === 'lazy') {
      // `lazy: () => import("./pages/Reports").then(m => ({ Component: … }))`
      // — o nome da tela mora no caminho do import, não em JSX. Termina no
      // primeiro `,`/`}` com parênteses E chaves zerados: parar na quebra de
      // linha comeria o `}` das declarações de uma linha só (price-lists e as
      // 18 irmãs), grudando todas as rotas seguintes numa só.
      let paren = 0, brace = 0, quote = null;
      for (end = j; end < src.length; end++) {
        const c = src[end];
        if (quote) { if (c === quote && src[end - 1] !== '\\') quote = null; continue; }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
        if (c === '(') paren++;
        else if (c === ')') paren--;
        else if (c === '{') brace++;
        else if (c === '}') { if (paren === 0 && brace === 0) break; brace--; }
        else if (c === ',' && paren === 0 && brace === 0) break;
      }
      const mod = (src.slice(j, end).match(/import\(\s*["']([^"']+)["']/) || [])[1];
      const name = mod ? mod.split('/').pop().replace(/\.\w+$/, '') : 'lazy';
      out.push(`element: "${name}"`);
      i = end;
      KEY.lastIndex = end;
      continue;
    }
    if (src[j] === '(') {
      // Bloco entre parênteses: balanceado, pode conter chaves à vontade.
      let depth = 0;
      for (end = j; end < src.length; end++) {
        if (src[end] === '(') depth++;
        else if (src[end] === ')') { depth--; if (depth === 0) { end++; break; } }
      }
    } else {
      // JSX solto (`element: <Navigate … />,`). Percorre até fechar todas as
      // tags e para ANTES do `,`/`}` que encerra a propriedade — consumir esse
      // `}` desbalancearia a pilha de escopo e grudaria rotas irmãs.
      let angle = 0;
      let quote = null;
      for (end = j; end < src.length; end++) {
        const c = src[end];
        if (quote) {
          if (c === quote && src[end - 1] !== '\\') quote = null;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
        if (c === '<') { angle++; continue; }
        if (c === '>') { angle--; continue; }
        if (angle <= 0 && (c === ',' || c === '}' || c === '\n')) break;
      }
    }
    const value = src.slice(j, end);
    // Desembrulha as molduras (Suspense/ProtectedRoute/…) pra chegar no
    // componente de tela — senão metade do inventário vira "Suspense".
    const WRAPPERS = new Set(['Suspense', 'ProtectedRoute', 'RouteGuard', 'ErrorBoundary', 'AppLayout', 'TabsProvider']);
    // `fallback={<PageSkeleton />}` é decoração de carregamento, não a tela.
    const body = value.replace(/\bfallback\s*=\s*\{[^}]*\}/g, '');
    const comps = [...body.matchAll(/<\s*([A-Z][\w.]*)/g)].map((x) => x[1]);
    const comp = comps.find((c) => !WRAPPERS.has(c)) || comps[0] || 'inline';
    const isRedirect = /<\s*(Navigate|LegacyRouteRedirect|LegacyInventoryRedirect|PedidosRedirect|RootRedirect)\b/.test(body);
    const target = (body.match(/\bto\s*=\s*["'{]?\s*["']?([^"'}\s]+)/) || [])[1] || null;
    out.push(`${m[1]}: "${comp}${isRedirect ? '|redirect' : ''}${target ? '|' + target : ''}"`);
    i = end;
    KEY.lastIndex = end;
  }
  out.push(src.slice(i));
  return out.join('');
}

function parseRoutes(appSrc) {
  const src = maskElements(appSrc);
  const lineOf = (idx) => appSrc.slice(0, idx).split('\n').length;
  // offsets do arquivo mascarado não batem com o original; usamos o path como
  // âncora pra achar a linha real depois.
  const routes = [];
  const stack = []; // { path, hasPath }
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      stack.push({ path: null, element: null, index: false, hasChildren: false });
      i++;
      continue;
    }
    if (ch === '}') {
      const frame = stack.pop();
      // Rota-layout (só agrupa `children`, sem tela própria): a tela real vem
      // do filho `index: true`, então não emitimos a moldura — senão o mesmo
      // path aparece duas vezes e vira falso "rota definida 2×".
      if (frame && frame.hasChildren && !frame.element) { i++; continue; }
      if (frame && (frame.path !== null || frame.index)) {
        const segs = stack.map((f) => f.path).filter(Boolean);
        if (frame.path) segs.push(frame.path);
        // Rota `index: true` não tem literal próprio — herda a linha do pai
        // pra que o relatório aponte um lugar real no arquivo.
        const parentRaw = [...stack].reverse().find((f) => f.path)?.path || null;
        const full = '/' + segs.join('/').replace(/^\/+/, '');
        const [comp, ...flags] = (frame.element || '').split('|');
        routes.push({
          path: full === '/' ? '/' : full.replace(/\/+$/, ''),
          raw: frame.path,
          parentRaw,
          component: comp || null,
          isRedirect: flags.includes('redirect'),
          redirectTo: flags.find((f) => f.startsWith('/')) || null,
          isIndex: frame.index,
          isDetail: /:/.test(full) || full.endsWith('/*'),
          // Rota-moldura: tem elemento próprio E filhos. A tela de verdade é
          // o filho `index`, então ela não conta como tela nem como duplicata.
          isLayout: frame.hasChildren,
        });
      }
      i++;
      continue;
    }
    const rest = src.slice(i, i + 260);
    let mm;
    if ((mm = rest.match(/^path\s*:\s*["']([^"']*)["']/))) {
      if (stack.length) stack[stack.length - 1].path = mm[1];
      i += mm[0].length;
      continue;
    }
    if ((mm = rest.match(/^(?:errorElement|element|lazy)\s*:\s*"([^"]*)"/))) {
      if (stack.length && !stack[stack.length - 1].element) {
        stack[stack.length - 1].element = mm[1];
      }
      i += mm[0].length;
      continue;
    }
    if ((mm = rest.match(/^index\s*:\s*true/))) {
      if (stack.length) stack[stack.length - 1].index = true;
      i += mm[0].length;
      continue;
    }
    if ((mm = rest.match(/^children\s*:\s*\[/))) {
      if (stack.length) stack[stack.length - 1].hasChildren = true;
      i += mm[0].length;
      continue;
    }
    i++;
  }
  // Linha real de cada rota. Rotas que repetem o mesmo literal (`inventory`
  // declarado 2×) precisam de ocorrências DIFERENTES, senão a duplicata
  // aparece com a mesma linha nos dois lados e ninguém acha a segunda.
  const used = new Map();
  for (const r of routes) {
    const literal = r.raw ?? r.parentRaw;
    if (!literal) { r.line = null; continue; }
    const esc = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`path\\s*:\\s*["']${esc}["']`, 'g');
    const hits = [...appSrc.matchAll(re)].map((m) => lineOf(m.index));
    const n = r.raw ? (used.get(literal) || 0) : 0;
    r.line = hits[Math.min(n, hits.length - 1)] ?? null;
    if (r.raw) used.set(literal, n + 1);
  }
  return routes;
}

// ════════════════════════════════════════════════════════════════════════
// 2. Navegação — src/data/navigation.ts
// ════════════════════════════════════════════════════════════════════════

function sliceExport(src, name) {
  const start = src.indexOf(`export const ${name}`);
  if (start < 0) return '';
  const open = src.search(new RegExp(`export const ${name}[^=]*=\\s*[\\[{]`));
  const from = src.indexOf(src[src.indexOf('=', start) + 1] === ' ' ? '' : '', start);
  let k = src.indexOf('=', start) + 1;
  while (k < src.length && /\s/.test(src[k])) k++;
  const openCh = src[k];
  const closeCh = openCh === '[' ? ']' : '}';
  let depth = 0;
  let end = k;
  for (; end < src.length; end++) {
    if (src[end] === openCh) depth++;
    else if (src[end] === closeCh) { depth--; if (depth === 0) { end++; break; } }
  }
  void open; void from;
  return src.slice(k, end);
}

function parseNavigation(navSrc) {
  const lineOf = (idx) => navSrc.slice(0, idx).split('\n').length;

  // L5: recursos não são mais reescritos em quatro formatos. Primeiro lemos
  // o catálogo único; as superfícies abaixo só referenciam seus paths.
  const catalogBlock = sliceExport(navSrc, 'navigationCatalog');
  const catalogAbs = navSrc.indexOf(catalogBlock);
  const resources = [];
  const resourceRe = /\{\s*path:\s*["']([^"']+)["']\s*,\s*label:\s*["']([^"']+)["']\s*,\s*group:\s*["']([^"']+)["']\s*,\s*icon:\s*[^,]+,\s*surfaces:\s*\[([^\]]*)\]/g;
  let resourceMatch;
  while ((resourceMatch = resourceRe.exec(catalogBlock)) !== null) {
    resources.push({
      path: resourceMatch[1],
      label: resourceMatch[2],
      group: resourceMatch[3],
      surfaces: [...resourceMatch[4].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]),
      line: lineOf(catalogAbs + resourceMatch.index),
    });
  }
  const resourceByPath = new Map(resources.map((item) => [item.path, item]));
  const pathsFromRefs = (block) => [...block.matchAll(/resource\(\s*["']([^"']+)["']\s*\)/g)]
    .map((m) => m[1]);
  const resolveResource = (path, surface) => {
    const item = resourceByPath.get(path);
    return item ? { ...item, surface } : { path, label: null, group: null, surface, line: null };
  };

  const topMatch = navSrc.match(/export const topItem\s*=\s*resource\(\s*["']([^"']+)["']\s*\)/);
  const topItem = resolveResource(topMatch?.[1] || '', 'topItem');

  const groupsBlock = sliceExport(navSrc, 'menuGroups');
  const groupsAbs = navSrc.indexOf(groupsBlock);
  const groups = [];
  const groupRe = /label\s*:\s*["']([^"']+)["'][\s\S]*?items\s*:\s*\[/g;
  let g;
  while ((g = groupRe.exec(groupsBlock)) !== null) {
    // corpo do array `items`
    let depth = 1;
    let e = groupRe.lastIndex;
    for (; e < groupsBlock.length; e++) {
      if (groupsBlock[e] === '[') depth++;
      else if (groupsBlock[e] === ']') { depth--; if (depth === 0) break; }
    }
    const body = groupsBlock.slice(groupRe.lastIndex, e);
    const items = pathsFromRefs(body).map((path) => resolveResource(path, 'menuGroups'));
    groups.push({ label: g[1], items, count: items.length, line: lineOf(groupsAbs + g.index) });
    groupRe.lastIndex = e;
  }

  const sysBlock = sliceExport(navSrc, 'systemItems');
  const systemItems = pathsFromRefs(sysBlock).map((path) => resolveResource(path, 'systemItems'));

  const secBlock = sliceExport(navSrc, 'secondaryRoutes');
  const secondaryRoutes = pathsFromRefs(secBlock).map((path) => resolveResource(path, 'secondaryRoutes'));

  return { topItem, groups, systemItems, secondaryRoutes, resources };
}

// ════════════════════════════════════════════════════════════════════════
// 3. Permissões — src/hooks/useAccessControl.ts
// ════════════════════════════════════════════════════════════════════════

function parseAccess(accessSrc) {
  const mapBlock = sliceExport(accessSrc, 'ROUTE_MODULE_MAP') || (() => {
    const s = accessSrc.indexOf('ROUTE_MODULE_MAP');
    let k = accessSrc.indexOf('{', s);
    let depth = 0, e = k;
    for (; e < accessSrc.length; e++) {
      if (accessSrc[e] === '{') depth++;
      else if (accessSrc[e] === '}') { depth--; if (depth === 0) { e++; break; } }
    }
    return accessSrc.slice(k, e);
  })();
  const routeModule = {};
  for (const m of mapBlock.matchAll(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/g)) {
    routeModule[m[1]] = m[2];
  }

  const rolesBlock = sliceExport(accessSrc, 'ROLE_MODULES');
  const roleModules = {};
  const roleRe = /(\w+)\s*:\s*\[([^\]]*)\]/g;
  let r;
  while ((r = roleRe.exec(rolesBlock)) !== null) {
    roleModules[r[1]] = [...r[2].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
  }

  const adminOnly = [...(accessSrc.match(/ADMIN_ONLY_MODULES\s*=\s*new Set\(\[([^\]]*)\]/) || [, ''])[1]
    .matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);

  return { routeModule, roleModules, adminOnly };
}

/** Espelha `resolveModuleForPath`: prefixo mais longo vence. */
function resolveModule(path, routeModule) {
  const key = Object.keys(routeModule)
    .sort((a, b) => b.length - a.length)
    .find((k) => path === k || path.startsWith(k + '/') || path.startsWith(k + '?'));
  return key ? routeModule[key] : null;
}

// ════════════════════════════════════════════════════════════════════════
// 4. Abas — varredura de src/pages e src/components
// ════════════════════════════════════════════════════════════════════════

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.tsx$/.test(name)) acc.push(full);
  }
  return acc;
}

/**
 * ⚠ Conta `<TabsTrigger>` por ARQUIVO, não por tela. Um arquivo que tem abas de
 * página E abas dentro de um `Dialog` soma as duas (Clients, ComponentSheets,
 * Contractors e SheetsAuditPanel caem nisso). Serve pra ranquear onde olhar —
 * o veredito de "abas demais" exige abrir o arquivo.
 */
function scanTabs(file) {
  const src = read(file);
  const triggers = [...src.matchAll(/<TabsTrigger\b[^>]*value\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/TabsTrigger>/g)];
  const triggerCount = (src.match(/<TabsTrigger\b/g) || []).length;
  if (!triggerCount) return null;

  const labels = triggers
    .map((m) => m[2].replace(/<[^>]*>/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const usesHubTabs = /HubTabsList/.test(src);
  // `useUrlTabState` É o contrato de deep-link (lote L6a): quem o usa lê E
  // escreve por definição. Sem reconhecê-lo aqui, migrar uma tela pro hook
  // faria o inventário reportá-la como REGRESSÃO — some o `searchParams.get`
  // literal do arquivo.
  const usaContrato = /useUrlTabState/.test(src);
  const readsTab = usaContrato || /searchParams\.get\(\s*["'](tab|view|sub|subtab)["']/.test(src);
  const writesTab = usaContrato || /setSearchParams\s*\(/.test(src);
  const usesLocalStorage = /usePersistedState\s*\(/.test(src);
  const indicatorNone = /indicator\s*=\s*["']none["']/.test(src);

  const heights = [...new Set([...src.matchAll(/<TabsList[^>]*className\s*=\s*["'`]([^"'`]*)["'`]/g)]
    .flatMap((m) => (m[1].match(/\bh-(?:\d+|auto)\b/g) || [])))];

  return {
    file: relative(ROOT, file),
    triggerCount,
    labels: labels.slice(0, 20),
    system: usesHubTabs ? 'HubTabsList' : indicatorNone ? 'shadcn+pill-manual' : 'shadcn-default',
    urlSync: readsTab && writesTab ? 'full' : readsTab ? 'read-only' : 'none',
    persistsLocalStorage: usesLocalStorage,
    heights,
    overloaded: triggerCount > 5,
  };
}

// ════════════════════════════════════════════════════════════════════════
// Execução
// ════════════════════════════════════════════════════════════════════════

const appSrc = read(p('src/App.tsx'));
const navSrc = read(p('src/data/navigation.ts'));
const accessSrc = read(p('src/hooks/useAccessControl.ts'));

const routes = parseRoutes(appSrc);
const nav = parseNavigation(navSrc);
const access = parseAccess(accessSrc);

const GROUP_LIMIT = 5;

// Superfícies de navegação achatadas
const navEntries = [
  nav.topItem,
  ...nav.groups.flatMap((g) => g.items.map((i) => ({ ...i, surface: 'menuGroups', group: g.label }))),
  ...nav.systemItems,
  ...nav.secondaryRoutes,
].filter((e) => e.path);

const navPaths = new Set(navEntries.map((e) => e.path));
const routeByPath = new Map(routes.map((r) => [r.path, r]));

// Telas = rota real: não é redirect, nem detalhe (:id / *), nem moldura.
const screens = routes.filter((r) => !r.isRedirect && !r.isDetail && !r.isLayout && r.path !== '/');
const redirects = routes.filter((r) => r.isRedirect);

/**
 * Rotas que estão FORA da sidebar de propósito — não são achado, são desenho.
 * Ficar sem entrada de menu é o comportamento correto delas. Tudo que não
 * casar aqui é candidato a órfã e precisa de decisão explícita.
 */
const EXEMPT_FROM_MENU = [
  { re: /^\/(auth|login)$/, reason: 'Fora do shell autenticado' },
  { re: /^\/m(\/|$)/, reason: 'PWA do representante — shell próprio com tab bar' },
  { re: /^\/design-preview$/, reason: 'Showcase interno do design system' },
  { re: /^\/navigation-audit$/, reason: 'Ferramenta de DEV, alcançada pelo banner de auditoria' },
  { re: /^\/(sales|orders)\/(new|edit)/, reason: 'Formulário — alcançado por ação, não por menu' },
  {
    re: /^\/orders\/(summary|grouped-summary)$/,
    // Sem seleção mostram estado vazio, então item de menu seria uma porta pra
    // lugar nenhum. `grouped-summary` é o preview de impressão que as 7 telas de
    // setor abrem com `?sector=…&ids=…`. Vira `?view=` dentro de /orders no L6.
    reason: 'Preview de impressão — depende de OPs selecionadas',
  },
  {
    re: /^\/pcp$/,
    // O L4 deixou este tradutor só para bookmarks com query; ele não deve
    // reaparecer no menu enquanto observamos os acessos restantes.
    reason: 'Tradutor temporário de bookmarks do PCP — revisar/remover até 27/10/2026',
  },
  {
    re: /^\/relatorios\/(diario-producao|op|oee|qualidade|refugo|semanal)$/,
    // Decisão D1: os A4 ainda usam dados de exemplo e não podem ser promovidos
    // por menu até receberem fonte real e validação do documento impresso.
    reason: 'Relatório A4 bloqueado por D1 até dados reais e validação — revisar até 12/01/2027',
  },
];
const exemptReason = (path) => (EXEMPT_FROM_MENU.find((e) => e.re.test(path)) || {}).reason || null;

const orphanCandidates = screens.filter((r) => !navPaths.has(r.path) && !exemptReason(r.path));
const orphanRoutes = orphanCandidates.map((r) => ({ path: r.path, component: r.component, line: r.line }));
const exemptRoutes = screens
  .filter((r) => !navPaths.has(r.path) && exemptReason(r.path))
  .map((r) => ({ path: r.path, component: r.component, reason: exemptReason(r.path) }));

const ghostNavEntries = navEntries
  .filter((e) => !routeByPath.has(e.path))
  .map((e) => ({ path: e.path, label: e.label, surface: e.surface }));

const navPointingAtRedirect = navEntries
  .filter((e) => routeByPath.get(e.path)?.isRedirect)
  .map((e) => ({ path: e.path, label: e.label, surface: e.surface, redirectTo: routeByPath.get(e.path).redirectTo }));

const duplicatePaths = (() => {
  const seen = new Map();
  const dupes = [];
  for (const e of navEntries) {
    if (seen.has(e.path)) dupes.push({ path: e.path, surfaces: [seen.get(e.path), e.surface] });
    else seen.set(e.path, e.surface);
  }
  return dupes;
})();

const duplicateRouteDefs = (() => {
  const seen = new Map();
  const dupes = [];
  for (const r of routes) {
    if (r.isDetail || r.isIndex || r.isLayout) continue;
    if (seen.has(r.path)) dupes.push({ path: r.path, lines: [seen.get(r.path), r.line], note: 'React Router usa a primeira; a segunda é inalcançável' });
    else seen.set(r.path, r.line);
  }
  return dupes;
})();

/** Paths dos itens da sidebar — usado só pra medir estouro de grupo. */
const menuPathsRaw = nav.groups.flatMap((g) => g.items.map((i) => i.path));

/**
 * Vocabulário de permissão = `grantableDestinations` (navigation.ts, lote L2).
 * Antes era só a sidebar, e por isso todo destino alcançado por busca, card ou
 * botão nascia sem dono e era negado em modo granular. Espelhamos a mesma
 * composição aqui pra o guard não reportar como problema o que já foi resolvido.
 */
const grantablePaths = nav.resources.map((item) => item.path);

/**
 * BottomNav tem itens PRIMÁRIOS escritos à mão, fora de `navigation.ts`. Se um
 * deles apontar pra rota que é só redirect ou que não é item de menu, ele some
 * pra todo usuário em modo granular (não há dono de menu pra resolver).
 */
const bottomNavFindings = (() => {
  let src = '';
  try { src = read(p('src/components/layout/BottomNav.tsx')); } catch { return []; }
  const items = [...src.matchAll(/label\s*:\s*['"]([^'"]+)['"]\s*,\s*path\s*:\s*['"]([^'"]+)['"]/g)]
    .map((m) => ({ label: m[1], path: m[2] }));
  const menuSet = new Set(grantablePaths);
  // `/dashboard` é liberado por regra explícita em isRouteAllowed (não precisa
  // de dono de menu), então não é achado.
  const ALWAYS_ALLOWED = new Set(['/dashboard']);
  return items
    .filter((i) => !ALWAYS_ALLOWED.has(i.path))
    .filter((i) => !menuSet.has(i.path) || routeByPath.get(i.path)?.isRedirect)
    .map((i) => ({
      ...i,
      isMenuItem: menuSet.has(i.path),
      isRedirectOnly: !!routeByPath.get(i.path)?.isRedirect,
      consequence: 'Sem dono de menu → canAccessRoute() nega em modo granular; a aba some no mobile',
    }));
})();

const groupOverflow = nav.groups
  .filter((g) => g.count > GROUP_LIMIT)
  .map((g) => ({ group: g.label, count: g.count, limit: GROUP_LIMIT, excess: g.count - GROUP_LIMIT }));

// Módulos referenciados no mapa de rotas que NENHUM perfil não-admin concede.
// Admin tem '*' e enxerga tudo, então não conta — o que interessa é o módulo
// que promete acesso a alguém e na prática não entrega a ninguém.
const grantedByNonAdmin = new Set(
  Object.entries(access.roleModules)
    .filter(([, mods]) => !mods.includes('*'))
    .flatMap(([, mods]) => mods),
);
const modulesGrantedToNobody = [...new Set(Object.values(access.routeModule))]
  .filter((m) => !grantedByNonAdmin.has(m))
  .filter((m) => !access.adminOnly.includes(m))
  .map((m) => ({
    module: m,
    routes: Object.entries(access.routeModule).filter(([, v]) => v === m).map(([k]) => k),
  }));

// Rota de navegação sem "dono" de menu → inacessível em modo granular
const menuPaths = grantablePaths;
const resolveOwner = (path) =>
  menuPaths.sort((a, b) => b.length - a.length).find((m) => path === m || path.startsWith(m + '/') || path.startsWith(m + '?')) || null;

/**
 * Rota sob o `RouteGuard` sem módulo em `ROUTE_MODULE_MAP`.
 *
 * Virou falha desde que `isRouteAllowed` passou a ser fail-closed (29/07/2026):
 * rota não classificada é NEGADA, então esquecer de classificar tranca o usuário
 * pra fora em silêncio. Alias legado conta — ele não renderiza tela, mas passa
 * pelo guard antes de redirecionar.
 *
 * Fora do RouteGuard (login, PWA do representante, showcase) não entra na conta.
 */
const OUTSIDE_ROUTE_GUARD = /^\/(auth|login|m(\/|$)|design-preview|producao\/kanban\/gestao)/;
const routesWithoutModule = [...new Map(
  routes
    .filter((r) => r.path !== '/' && r.path !== '/*' && !OUTSIDE_ROUTE_GUARD.test(r.path))
    .filter((r) => !resolveModule(r.path, access.routeModule))
    .map((r) => [r.path, r]),
).values()].map((r) => ({
  path: r.path,
  component: r.component,
  isRedirect: r.isRedirect,
  redirectTo: r.redirectTo,
  line: r.line,
}));

const navWithoutMenuOwner = navEntries
  .filter((e) => e.surface === 'secondaryRoutes' || e.surface === 'topItem')
  // `/dashboard` tem liberação explícita em isRouteAllowed e não precisa de dono.
  .filter((e) => e.path !== '/dashboard')
  .filter((e) => !resolveOwner(e.path))
  .map((e) => ({ path: e.path, label: e.label, surface: e.surface, module: resolveModule(e.path, access.routeModule) }));

// Matriz perfil × item de menu visível
const roleVisibility = Object.fromEntries(
  Object.entries(access.roleModules).map(([role, mods]) => {
    const all = mods.includes('*');
    const set = new Set(mods);
    const visible = nav.groups.flatMap((g) =>
      g.items.filter((i) => {
        const mod = resolveModule(i.path, access.routeModule);
        if (mod && access.adminOnly.includes(mod)) return all;
        return all || (mod ? set.has(mod) : true);
      }).map((i) => i.path),
    );
    const emptyGroups = nav.groups
      .filter((g) => !g.items.some((i) => visible.includes(i.path)))
      .map((g) => g.label);
    return [role, { visibleCount: visible.length, totalMenuItems: menuPathsRaw.length, emptyGroups }];
  }),
);

// Abas
const tabFiles = [...walk(p('src/pages')), ...walk(p('src/components'))]
  .map(scanTabs)
  .filter(Boolean)
  .sort((a, b) => b.triggerCount - a.triggerCount);

const inventory = {
  generatedFor: 'Squad Shoes — reorganização de IA (menus, abas, perfis)',
  totals: {
    routesDeclared: routes.length,
    screens: screens.length,
    redirects: redirects.length,
    navEntries: navEntries.length,
    // `getAllMenuItems()` continua semântica de sidebar; destinos concedíveis
    // incluem Cmd+K e ações e não podem inflar essa métrica visual.
    menuItems: menuPathsRaw.length,
    grantableDestinations: grantablePaths.length,
    menuGroups: nav.groups.length,
    pagesWithTabs: tabFiles.length,
    tabsWithoutUrl: tabFiles.filter((t) => t.urlSync === 'none').length,
    tabsOverloaded: tabFiles.filter((t) => t.overloaded).length,
  },
  findings: {
    orphanRoutes,
    exemptRoutes,
    ghostNavEntries,
    navPointingAtRedirect,
    bottomNavFindings,
    duplicateNavPaths: duplicatePaths,
    duplicateRouteDefs,
    groupOverflow,
    modulesGrantedToNobody,
    navWithoutMenuOwner,
    routesWithoutModule,
    routesWithoutModule,
  },
  navigation: {
    topItem: nav.topItem,
    groups: nav.groups.map((g) => ({ label: g.label, count: g.count, items: g.items })),
    systemItems: nav.systemItems,
    secondaryRoutes: nav.secondaryRoutes,
  },
  roleVisibility,
  routes,
  tabs: tabFiles,
};

/** Exportado pra `check-navigation-access.mjs` cobrar os mesmos achados no CI. */
export default inventory;
export { inventory };

// Daqui pra baixo só roda quando invocado direto — importar não deve escrever
// arquivo nem imprimir nada.
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {

const outArg = process.argv.indexOf('--out');
const outFile = outArg > -1 ? process.argv[outArg + 1] : p('docs/ia-inventory.json');
writeFileSync(outFile, JSON.stringify(inventory, null, 2));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(inventory, null, 2));
} else {
  const t = inventory.totals;
  const f = inventory.findings;
  console.log(`\n📐 Inventário de IA — Squad Shoes\n`);
  console.log(`  Rotas declaradas .............. ${t.routesDeclared}`);
  console.log(`    telas ....................... ${t.screens}`);
  console.log(`    redirects ................... ${t.redirects}`);
  console.log(`  Entradas de navegação ......... ${t.navEntries}  (${t.menuItems} na sidebar, ${t.menuGroups} grupos)`);
  console.log(`  Páginas com abas .............. ${t.pagesWithTabs}`);
  console.log(`    sem deep-link ............... ${t.tabsWithoutUrl}`);
  console.log(`    com mais de 5 abas .......... ${t.tabsOverloaded}`);
  console.log(`\n  Achados:`);
  console.log(`    telas órfãs (sem navegação) . ${f.orphanRoutes.length}   (+${f.exemptRoutes.length} isentas por desenho)`);
  console.log(`    entradas fantasma ........... ${f.ghostNavEntries.length}`);
  console.log(`    menu → rota de redirect ..... ${f.navPointingAtRedirect.length}`);
  console.log(`    BottomNav quebrado .......... ${f.bottomNavFindings.length}`);
  console.log(`    path duplicado no menu ...... ${f.duplicateNavPaths.length}`);
  console.log(`    rota definida 2× ............ ${f.duplicateRouteDefs.length}`);
  console.log(`    grupos acima de ${GROUP_LIMIT} itens .... ${f.groupOverflow.length}`);
  console.log(`    módulo sem perfil ........... ${f.modulesGrantedToNobody.length}`);
  console.log(`    sem dono de menu (granular) . ${f.navWithoutMenuOwner.length}`);
  console.log(`    rota sem módulo (fail-closed) ${f.routesWithoutModule.length}`);
  console.log(`\n  → ${relative(ROOT, outFile)}\n`);
}

} // fim do bloco CLI
