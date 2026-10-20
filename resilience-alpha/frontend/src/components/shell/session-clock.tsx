"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { TIME_ZONE } from "@/lib/format";

const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });

export function SessionClock({ exp }: { exp: number }) {
  return (
    <span>
      session jusqu&apos;à <time dateTime={new Date(exp * 1000).toISOString()}>{timeFmt.format(new Date(exp * 1000))}</time>
    </span>
  );
}

/** Le jeton dure 15 min sans renouvellement : à l'échéance, renvoie vers la connexion puis vers la page courante. */
export function useSessionExpiry(exp: number) {
  const router = useRouter();
  useEffect(() => {
    const go = () => {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?expired=1&next=${next}`);
    };
    const ms = exp * 1000 - Date.now();
    if (ms <= 0) {
      go();
      return;
    }
    const t = setTimeout(go, Math.min(ms, 2_147_000_000));
    return () => clearTimeout(t);
  }, [exp, router]);
}
