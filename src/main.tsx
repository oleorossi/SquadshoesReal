// Build trigger: 2026-05-12 — teste 3 (VERCEL_ORG_ID adicionado)
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { GlobalErrorBoundary } from "./components/GlobalErrorBoundary";
 import "./index.css";
 import "./styles-paper.css";
import { installWhiteLabelGuard } from "./lib/whiteLabelGuard";
import { installChunkErrorHandler } from "./lib/chunkErrorHandler";
import { tryReserveReload } from "./lib/recoveryReload";
import { clearStalePwaArtifacts } from "./utils/pwa-utils";

// White-label runtime guard: remove badges/branding injetados via script
// (cobre casos não pegos pelo CSS estático e shadow DOM dinâmico).
installWhiteLabelGuard();

// Chunk error recovery — reload automático se import() dinâmico falhar
// (caso "Importing a module script failed"). Complementa o handler
// `vite:preloadError` abaixo, cobrindo cenários que ele não pega
// (Promise rejection direto, error events genéricos, dev mode com HMR
// quebrado). Ver src/lib/chunkErrorHandler.ts pra detalhes.
installChunkErrorHandler();

// SW de cache desligado. O vite-plugin-pwa roda em modo `selfDestroying` e o
// /squad-vendas-sw.js gerado se desregistra + limpa caches no activate (ver
// vite.config.ts). Este unregister-all é cinto-e-suspensório: mata QUALQUER SW
// remanescente em todo load — inclusive o /sw.js legado (também self-destruct)
// e o squad-vendas-sw.js entre uma visita e outra. NÃO é "nenhum SW registrado":
// o registerSW.js (injectRegister) re-registra o destruidor a cada load; ele só
// não persiste nem controla a aba (o template não chama clients.claim()).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  }).catch(() => {});
}

// Log version info for debugging "old version" issues (DEV only)
if (import.meta.env.DEV) {
  console.log(`[App] Version: ${import.meta.env.VITE_APP_VERSION} | Built: ${new Date().toLocaleString()}`);
}

// Adicionar um atalho global para depuração
 (window as any).forceAppUpdate = async () => {
   if (import.meta.env.DEV) console.warn("Forçando atualização manual do sistema...");
   localStorage.clear();
   sessionStorage.clear();
   await clearStalePwaArtifacts().catch(() => {});
   const url = new URL(window.location.href);
   url.searchParams.set('_r', String(Date.now()));
   window.location.replace(url.toString());
 };

// Recuperação automática de chunk obsoleto: quando um deploy novo remove os
// .js hasheados antigos, uma aba aberta no deploy anterior falha o import
// dinâmico de rota ("Importing a module script failed"). O Vite dispara
// `vite:preloadError` nesse caso — recarregamos a página pra pegar o index.html
// novo. O orçamento global de recuperação (recoveryReload.ts) é COMPARTILHADO
// com o chunkErrorHandler e o VersionChecker, então não há reloads encadeados
// entre os três; esgotado o orçamento, deixamos o erro aparecer (sem loop).
window.addEventListener("vite:preloadError", (e) => {
  if (tryReserveReload()) {
    e.preventDefault();
    window.location.reload();
  }
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Failed to find the root element");

createRoot(rootElement).render(
  <GlobalErrorBoundary>
    <App />
  </GlobalErrorBoundary>
);
