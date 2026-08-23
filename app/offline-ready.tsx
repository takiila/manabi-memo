"use client";

import { useEffect, useRef, useState } from "react";

export default function OfflineReady() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloadForUpdate = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | null = null;
    const showWaitingWorker = () => {
      if (registration?.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
    };
    const controllerChanged = () => {
      if (reloadForUpdate.current) window.location.reload();
    };
    const checkForUpdate = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };
    navigator.serviceWorker.addEventListener("controllerchange", controllerChanged);
    document.addEventListener("visibilitychange", checkForUpdate);
    const timer = window.setInterval(checkForUpdate, 60 * 60 * 1000);
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((value) => {
      registration = value;
      showWaitingWorker();
      registration.addEventListener("updatefound", () => {
        const installing = registration?.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed") showWaitingWorker();
        });
      });
      void registration.update();
    });
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkForUpdate);
      navigator.serviceWorker.removeEventListener("controllerchange", controllerChanged);
    };
  }, []);

  if (!waiting) return null;
  return <aside role="status" aria-live="polite" style={{ position: "fixed", zIndex: 1000, right: 16, bottom: 16, maxWidth: 340, padding: 14, borderRadius: 14, color: "#f7faf8", background: "#274a41", boxShadow: "0 12px 35px rgba(20, 40, 35, .24)" }}>
    <strong style={{ display: "block", marginBottom: 6 }}>まなびメモを更新できます</strong>
    <span style={{ display: "block", marginBottom: 10, fontSize: 13, lineHeight: 1.5 }}>端末内の内容を保ったまま、新しい版を読み込みます。</span>
    <button type="button" onClick={() => { reloadForUpdate.current = true; waiting.postMessage({ type: "SKIP_WAITING" }); }} style={{ border: 0, borderRadius: 999, padding: "8px 14px", fontWeight: 700, color: "#274a41", background: "#fff" }}>今すぐ更新</button>
  </aside>;
}
