"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning-tint px-4 py-2 text-[13px] text-fg">
      <WifiOff aria-hidden="true" className="size-4 text-warning" />
      Hors ligne : les données affichées peuvent être périmées. Elles seront rechargées au retour du réseau.
    </div>
  );
}
