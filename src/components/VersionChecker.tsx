 import { useEffect, useState, useCallback } from "react";
 import { toast } from "sonner";
 import { RefreshCw, X, AlertCircle, Keyboard } from "lucide-react";
 
 const RELOAD_COOLDOWN_MS = 15_000;
 const POLL_INTERVAL_MS = 5 * 60 * 1000;
 const ATTEMPT_KEY = "version_reload_attempts";
 const LAST_RELOAD_KEY = "last_version_reload";
 const MAX_AUTO_ATTEMPTS = 2;
 
 async function clearAllClientCaches() {
   if ("caches" in window) {
     try {
       const keys = await caches.keys();
       await Promise.all(keys.map(key => caches.delete(key)));
     } catch (e) {
       console.error("[VersionChecker] Failed to clear caches:", e);
     }
   }
   if ("serviceWorker" in navigator) {
     try {
       const regs = await navigator.serviceWorker.getRegistrations();
       await Promise.all(regs.map(reg => reg.unregister()));
     } catch (e) {
       console.error("[VersionChecker] Failed to unregister SW:", e);
     }
   }
 }
 
 /**
  * Hard reload bypassing browser and CDN cache.
  * Navigates to root path with timestamp so CDN treats it as a new URL.
  */
 async function forceHardReload(serverVersion?: string) {
   await clearAllClientCaches();
 
   const attempts = parseInt(sessionStorage.getItem(ATTEMPT_KEY) ?? "0", 10);
   sessionStorage.setItem(ATTEMPT_KEY, String(attempts + 1));
   sessionStorage.setItem(LAST_RELOAD_KEY, Date.now().toString());
 
   // Navigate to root with timestamp — CDN must re-evaluate this URL
   const url = new URL(window.location.origin);
   if (serverVersion) url.searchParams.set("v", serverVersion);
   url.searchParams.set("t", Date.now().toString());
   window.location.replace(url.toString());
 }
 
 const checkVersionLogic = async (
   isManual = false,
   onMismatch?: (server: string, local: string) => void,
 ) => {
   try {
     const response = await fetch(`/version.json?t=${Date.now()}`, {
       cache: "no-cache",
       headers: {
         Pragma: "no-cache",
         "Cache-Control": "no-cache, no-store, must-revalidate",
         "X-Version-Check": "true",
       },
     });
 
     if (!response.ok) return false;
 
     const data = await response.json();
     const serverVersion = data.version;
     const localVersion = import.meta.env.VITE_APP_VERSION;
 
     if (serverVersion && localVersion && serverVersion !== localVersion) {
       console.warn(
         `[VersionChecker] Mismatch detected. Server: ${serverVersion} | Local: ${localVersion}`,
       );
       onMismatch?.(serverVersion, localVersion);
       return true;
     }
 
     if (isManual) {
       toast.success("Sistema atualizado", {
         description: "Você já está usando a versão mais recente.",
       });
     }
     return false;
   } catch (error) {
     console.error("[VersionChecker] Failed to check version:", error);
     if (isManual) {
       toast.error("Erro ao verificar versão", {
         description: "Não foi possível conectar ao servidor de atualização.",
       });
     }
     return false;
   }
 };
 
 export const manualVersionCheck = () => checkVersionLogic(true);
 
 export const VersionChecker = () => {
   const [pendingVersion, setPendingVersion] = useState<string | null>(null);
   const [reloading, setReloading] = useState(false);
   // True when auto-reload failed (CDN served cached HTML) — show manual instructions
   const [cdnStuck, setCdnStuck] = useState(false);
 
   const handleMismatch = useCallback((server: string) => {
     setPendingVersion(server);
     // If we've already tried auto-reload multiple times, CDN cache is the problem
     const attempts = parseInt(sessionStorage.getItem(ATTEMPT_KEY) ?? "0", 10);
     if (attempts >= MAX_AUTO_ATTEMPTS) {
       setCdnStuck(true);
     }
   }, []);
 
   const handleReloadNow = useCallback(async () => {
     if (reloading) return;
     setReloading(true);
     toast.info("Atualizando...", {
       description: "Limpando cache e baixando a versão mais recente.",
       duration: 3000,
     });
     await forceHardReload(pendingVersion ?? undefined);
   }, [pendingVersion, reloading]);
 
   // Auto-trigger reload once, with cooldown protection against loops
   useEffect(() => {
     if (!pendingVersion || cdnStuck) return;
     const lastReload = sessionStorage.getItem(LAST_RELOAD_KEY);
     const now = Date.now();
     if (lastReload && now - parseInt(lastReload, 10) < RELOAD_COOLDOWN_MS) {
       console.log("[VersionChecker] Skipping auto-reload (cooldown active)");
       // If we've tried before and still have a mismatch, CDN is caching
       const attempts = parseInt(sessionStorage.getItem(ATTEMPT_KEY) ?? "0", 10);
       if (attempts >= MAX_AUTO_ATTEMPTS) setCdnStuck(true);
       return;
     }
     const timer = setTimeout(() => {
       handleReloadNow();
     }, 2000);
     return () => clearTimeout(timer);
   }, [pendingVersion, cdnStuck, handleReloadNow]);
 
   useEffect(() => {
     const check = () => checkVersionLogic(false, handleMismatch);
     check();
     const interval = setInterval(check, POLL_INTERVAL_MS);
     return () => clearInterval(interval);
   }, [handleMismatch]);
 
   if (!pendingVersion) return null;
 
   return (
     <div
       role="alert"
       aria-live="assertive"
       className="fixed top-0 inset-x-0 z-toast shadow-lg"
     >
       {/* Main update bar */}
       <div className="flex items-center justify-center gap-3 bg-amber-500 text-amber-950 px-4 py-2.5 text-sm font-medium">
         <AlertCircle className="h-4 w-4 shrink-0" />
         <span className="flex-1 text-center">
           {reloading
             ? "Atualizando para a versão mais recente..."
             : "Nova versão disponível. Atualize para ver as mudanças mais recentes."}
         </span>
         <button
           type="button"
           onClick={handleReloadNow}
           disabled={reloading}
           className="inline-flex items-center gap-1.5 rounded-md bg-amber-950 text-amber-50 px-3 py-1 text-xs font-semibold hover:bg-amber-900 transition-colors disabled:opacity-60"
         >
           <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} />
           {reloading ? "Atualizando…" : "Atualizar agora"}
         </button>
         <button
           type="button"
           onClick={() => { setPendingVersion(null); setCdnStuck(false); }}
           aria-label="Dispensar"
           className="text-amber-950/70 hover:text-amber-950 transition-colors"
         >
           <X className="h-4 w-4" />
         </button>
       </div>
 
       {/* Secondary bar: manual instructions when CDN is caching */}
       {cdnStuck && (
         <div className="flex items-center justify-center gap-2 bg-amber-950 text-amber-100 px-4 py-2 text-xs">
           <Keyboard className="h-3.5 w-3.5 shrink-0" />
           <span>
             A atualização automática está bloqueada pelo cache. Pressione{" "}
             <kbd className="rounded bg-amber-800 px-1.5 py-0.5 font-mono font-semibold">Ctrl+Shift+R</kbd>{" "}
             (Windows/Linux) ou{" "}
             <kbd className="rounded bg-amber-800 px-1.5 py-0.5 font-mono font-semibold">⌘+Shift+R</kbd>{" "}
             (Mac) para forçar o recarregamento.
           </span>
         </div>
       )}
     </div>
   );
 };
