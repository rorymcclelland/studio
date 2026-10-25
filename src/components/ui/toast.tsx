"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "./cx";

export type ToastTone = "good" | "attention" | "neutral";
export type ToastInput = { message: string; tone?: ToastTone };
type ToastItem = Required<ToastInput> & { id: number };

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

/** How long a non-error toast stays up. Errors stay until dismissed. */
const AUTO_DISMISS_MS = 6000;

/**
 * Holds the toasts for action results ("Decision recorded."). Put it once
 * around the signed-in app; call useToast() anywhere inside.
 *
 * The live regions are always in the page, so screen readers announce each
 * toast: results politely, errors at once. Toasts rise in gently, unless
 * motion is reduced.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((t: ToastInput) => {
    const item = { id: next.current++, message: t.message, tone: t.tone ?? "good" };
    setItems((xs) => [...xs.slice(-2), item]);
  }, []);
  const results = items.filter((t) => t.tone !== "attention");
  const errors = items.filter((t) => t.tone === "attention");
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
        <div role="status" aria-live="polite" className="flex w-full flex-col items-center gap-2 sm:items-end">
          {results.map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" className="flex w-full flex-col items-center gap-2 sm:items-end">
          {errors.map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

/** Shows a toast. Returns a no-op outside a ToastProvider, so components still render. */
export function useToast(): (t: ToastInput) => void {
  const show = useContext(ToastContext);
  return useMemo(() => show ?? (() => {}), [show]);
}

const TONES: Record<ToastTone, string> = {
  good: "bg-good",
  attention: "bg-attention",
  neutral: "bg-primary",
};

/** One toast. Exported for the component page; the app uses ToastProvider. */
export function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss?: (id: number) => void }) {
  useEffect(() => {
    if (!onDismiss || item.tone === "attention") return;
    const t = setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [item.id, item.tone, onDismiss]);
  return (
    <div
      data-toast=""
      className="toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card bg-surface p-4 shadow-lg ring-1 shadow-ink/10 ring-line"
    >
      <span aria-hidden className={cx("mt-1.5 size-2.5 shrink-0 rounded-full", TONES[item.tone])} />
      <p className="min-w-0 flex-1 font-medium wrap-break-word">{item.message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          className="-my-1 shrink-0 rounded-full px-2 py-1 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
