// Build trigger: 2026-05-12 — teste 3 (VERCEL_ORG_ID adicionado)
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { GlobalErrorBoundary } from "./components/GlobalErrorBoundary";
 import "./index.css";
import { installWhiteLabelGuard } from "./lib/whiteLabelGuard";

// White-label runtime guard: remove badges/branding injetados via script
// (cobre casos não pegos pelo CSS estático e shadow DOM dinâmico).
installWhiteLabelGuard();

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

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Failed to find the root element");

createRoot(rootElement).render(
  <GlobalErrorBoundary>
    <App />
  </GlobalErrorBoundary>
);
