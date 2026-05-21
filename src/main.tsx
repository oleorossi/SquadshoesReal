// Build trigger: 2026-05-12 — teste 3 (VERCEL_ORG_ID adicionado)
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { GlobalErrorBoundary } from "./components/GlobalErrorBoundary";
 import "./index.css";
 import "./styles-paper.css";
import { installWhiteLabelGuard } from "./lib/whiteLabelGuard";
import { installChunkErrorHandler } from "./lib/chunkErrorHandler";

// White-label runtime guard: remove badges/branding injetados via script
// (cobre casos não pegos pelo CSS estático e shadow DOM dinâmico).
installWhiteLabelGuard();

// Chunk error recovery — reload automático se import() dinâmico falhar
// (caso "Importing a module script failed"). Complementa o handler
// `vite:preloadError` abaixo, cobrindo cenários que ele não pega
// (Promise rejection direto, error events genéricos, dev mode com HMR
// quebrado). Ver src/lib/chunkErrorHandler.ts pra detalhes.
installChunkErrorHandler();

// Service Worker desabilitado — estava causando trava de cache em deploys.
// Para usuários que ainda têm o SW antigo instalado, /sw.js agora é uma
// versão self-destruct que limpa tudo e se desregistra automaticamente.
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
 (window as any).forceAppUpdate = () => {
   if (import.meta.env.DEV) console.warn("Forçando atualização manual do sistema...");
   localStorage.clear();
   sessionStorage.clear();
   if ('serviceWorker' in navigator) {
     navigator.serviceWorker.getRegistrations().then(registrations => {
       registrations.forEach(registration => registration.unregister());
     });
   }
   window.location.reload();
 };

// Recuperação automática de chunk obsoleto: quando um deploy novo remove os
// .js hasheados antigos, uma aba aberta no deploy anterior falha o import
// dinâmico de rota ("Importing a module script failed"). O Vite dispara
// `vite:preloadError` nesse caso — recarregamos a página 1x pra pegar o
// index.html novo. O flag em sessionStorage evita loop infinito caso o erro
// persista por outro motivo (ex.: chunk realmente quebrado).
window.addEventListener("vite:preloadError", (e) => {
  const KEY = "vite-preload-reload";
  if (sessionStorage.getItem(KEY)) return; // já tentamos — deixa o erro aparecer
  sessionStorage.setItem(KEY, String(Date.now()));
  e.preventDefault();
  window.location.reload();
});
// Após um carregamento bem-sucedido, limpa o flag pra liberar futuras
// recuperações (deploys seguintes).
setTimeout(() => sessionStorage.removeItem("vite-preload-reload"), 8000);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Failed to find the root element");

createRoot(rootElement).render(
  <GlobalErrorBoundary>
    <App />
  </GlobalErrorBoundary>
);
