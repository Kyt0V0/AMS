import { useSyncExternalStore } from "react";

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

function snapshot(): string {
  return window.location.hash.replace(/^#\/?/, "");
}

export function useRoute(): string[] {
  const path = useSyncExternalStore(subscribe, snapshot);
  return path.split("/").filter(Boolean).map(decodeURIComponent);
}

export function navigate(path: string, replace = false): void {
  const target = `#/${path.replace(/^\/+/, "")}`;
  if (replace) {
    window.history.replaceState(null, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = target;
  }
}
