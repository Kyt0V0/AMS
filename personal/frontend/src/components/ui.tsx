import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, Eye, EyeOff, Info, LoaderCircle, X } from "lucide-react";
import { ApiError } from "../lib/api";
import { WrongSecretError } from "../lib/crypto";
import type { Strength } from "../lib/password";
import { useI18n, type MessageKey, type Translate } from "../i18n";

export function errorText(t: Translate, error: unknown): string {
  if (error instanceof WrongSecretError) return t("err_wrong_password");
  if (error instanceof ApiError) {
    if (error.status === 0) return t("err_network");
    if (error.status === 429) return t("err_rate_limited", { seconds: error.retryAfter ?? 60 });
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function useAction() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setFailure(caught ?? new Error("Unknown error"));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error: failure === null ? null : errorText(t, failure), run };
}

export function Spinner({ large = false }: { large?: boolean }) {
  return <LoaderCircle className={large ? "spin spin-lg" : "spin"} aria-hidden="true" />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  icon?: ReactNode;
  busy?: boolean;
  small?: boolean;
  block?: boolean;
};

export function Button({ variant = "secondary", icon, busy, small, block, children, className, disabled, ...rest }: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, small && "btn-sm", block && "btn-block", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} disabled={disabled || busy} {...rest}>
      {busy ? <Spinner /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" className={`icon-btn ${className ?? ""}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <span className="input-group">
      <input
        className="input"
        type={visible ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="off"
        {...props}
      />
      <IconButton label={t(visible ? "hide" : "show")} onClick={() => setVisible((v) => !v)}>
        {visible ? <EyeOff /> : <Eye />}
      </IconButton>
    </span>
  );
}

const STRENGTH_LABEL: MessageKey[] = ["strength_0", "strength_1", "strength_2", "strength_3", "strength_4"];

export function StrengthMeter({ score, empty }: { score: Strength; empty: boolean }) {
  const { t } = useI18n();
  return (
    <span className={`strength strength-${empty ? "none" : score}`}>
      <span className="strength-bars" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={!empty && i <= score - 1 ? "on" : ""} />
        ))}
      </span>
      <span className="strength-label">{empty ? "" : t(STRENGTH_LABEL[score])}</span>
    </span>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const icon = tone === "ok" ? <CheckCircle2 /> : tone === "info" ? <Info /> : <AlertTriangle />;
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "warn" | "danger" | "ok"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  const hue = useMemo(() => {
    let hash = 7;
    for (const char of name) hash = (hash * 131 + char.charCodeAt(0)) >>> 0;
    return (hash * 47) % 360;
  }, [name]);
  return (
    <span className={large ? "avatar avatar-lg" : "avatar"} style={{ "--hue": hue } as CSSProperties} aria-hidden="true">
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  variant = "modal",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "modal" | "drawer" | "modal-wide";
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${variant}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog-panel">
        <header className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton label={t("close")} onClick={onClose}>
            <X />
          </IconButton>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            busy={action.busy}
            onClick={async () => {
              if (await action.run(onConfirm)) onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        {children}
        {action.error && <Alert tone="error">{action.error}</Alert>}
      </div>
    </Modal>
  );
}

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
}

const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const layer = useRef<HTMLDivElement>(null);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = nextId.current++;

    try {
      layer.current?.hidePopover();
      layer.current?.showPopover();
    } catch {
    }
    setToasts((list) => [...list.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" popover="manual" ref={layer}>
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            {toast.tone === "ok" ? <Check /> : <AlertTriangle />}
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const CLIPBOARD_CLEAR_MS = 30_000;
let clipboardTimer: number | undefined;

export function useCopy() {
  const { t } = useI18n();
  const toast = useToast();
  return useCallback(
    async (text: string, secret = false) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        toast(t("copy_failed"), "error");
        return;
      }
      window.clearTimeout(clipboardTimer);
      if (secret) {
        clipboardTimer = window.setTimeout(() => {
          navigator.clipboard.writeText("").catch(() => undefined);
        }, CLIPBOARD_CLEAR_MS);
      }
      toast(t(secret ? "copied_secret" : "copied"));
    },
    [t, toast],
  );
}

export function CopyButton({ value, secret = false, label }: { value: string; secret?: boolean; label?: string }) {
  const { t } = useI18n();
  const copy = useCopy();
  return (
    <IconButton label={label ?? t("copy")} onClick={() => void copy(value, secret)} disabled={!value}>
      <Copy />
    </IconButton>
  );
}
