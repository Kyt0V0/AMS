import { useState, type FormEvent, type ReactNode } from "react";
import { Download, HardDrive, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { createAccount, deriveRecoveryKeys, recoverAccount } from "../lib/crypto";
import { navigate } from "../lib/router";
import { useI18n } from "../i18n";
import { useSession } from "../state/session";
import { Alert, Avatar, Button, Field, PasswordInput, Spinner, useAction } from "../components/ui";
import { NewPasswordFields, RecoveryCodeBox, type NewPassword } from "../components/PasswordFields";
import { LanguageSelect, ThemeSwitch } from "../components/Preferences";

export function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark">
        <ShieldCheck />
      </span>
      <span className="logo-text">AMS</span>
    </span>
  );
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="auth">
      <aside className="auth-brand">
        <Logo />
        <div className="auth-pitch">
          <h1>{t("app_name")}</h1>
          <p>{t("brand_tagline")}</p>
          <ul>
            <li>
              <Lock />
              <span>{t("brand_point_encrypted")}</span>
            </li>
            <li>
              <HardDrive />
              <span>{t("brand_point_local")}</span>
            </li>
            <li>
              <KeyRound />
              <span>{t("brand_point_zero_knowledge")}</span>
            </li>
          </ul>
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <header>
            <h2>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </header>
          {children}
        </div>
        <footer className="auth-foot">
          <LanguageSelect />
          <ThemeSwitch />
        </footer>
      </main>
    </div>
  );
}

export function StatusPage({ kind, onRetry }: { kind: "loading" | "insecure" | "unreachable"; onRetry?: () => void }) {
  const { t } = useI18n();
  if (kind === "loading") {
    return (
      <div className="center-screen">
        <Spinner large />
      </div>
    );
  }
  return (
    <AuthShell title={t(kind === "insecure" ? "insecure_title" : "unreachable_title")}>
      <Alert tone="warn">{t(kind === "insecure" ? "insecure_body" : "unreachable_body")}</Alert>
      {onRetry && (
        <Button variant="primary" block onClick={onRetry}>
          {t("retry")}
        </Button>
      )}
    </AuthShell>
  );
}

export function UnlockPage() {
  const { t } = useI18n();
  const { unlock, expired, ownerName } = useSession();
  const [password, setPassword] = useState("");
  const action = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(() => unlock(password));
  };

  return (
    <AuthShell title={t("unlock_title")} subtitle={t("unlock_subtitle")}>
      {ownerName && (
        <div className="identity">
          <Avatar name={ownerName} large />
          <div>
            <strong>{ownerName}</strong>
            <span className="muted">{t("this_computer_only")}</span>
          </div>
        </div>
      )}
      <form className="stack" onSubmit={submit}>
        {expired && !action.error && <Alert tone="info">{t("session_ended")}</Alert>}
        {action.error && <Alert tone="error">{action.error}</Alert>}
        <Field label={t("master_password")}>
          <PasswordInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
        </Field>
        <Button type="submit" variant="primary" block busy={action.busy}>
          {action.busy ? t("deriving_keys") : t("unlock")}
        </Button>
      </form>
      <div className="auth-links">
        <a href="#/recover">{t("forgot_password")}</a>
      </div>
    </AuthShell>
  );
}

function RecoveryCodePanel({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);

  const download = () => {
    const text = `AMS Personal recovery code\nCode: ${code}\n\n${t("recovery_file_note")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ams-personal-recovery-code.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="stack">
      <RecoveryCodeBox code={code} />
      <Button icon={<Download />} onClick={download}>
        {t("download")}
      </Button>
      <label className="check">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
        <span>{t("recovery_saved_confirm")}</span>
      </label>
      <Button variant="primary" block disabled={!saved} onClick={onDone}>
        {t("continue")}
      </Button>
    </div>
  );
}

export function SetupPage() {
  const { t } = useI18n();
  const { policy, start } = useSession();
  const [name, setName] = useState("");
  const [password, setPassword] = useState<NewPassword>({ value: "", valid: false });
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const action = useAction();
  if (!policy) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const { account, recoveryCode: code } = await createAccount(password.value, policy);
      await api.setup({ ...account, name: name.trim() });
      setRecoveryCode(code);
    });
  };

  return (
    <AuthShell title={t("setup_title")} subtitle={t("setup_subtitle")}>
      {recoveryCode ? (
        <RecoveryCodePanel code={recoveryCode} onDone={() => void start()} />
      ) : (
        <form className="stack" onSubmit={submit}>
          {action.error && <Alert tone="error">{action.error}</Alert>}
          <Field label={t("your_name")}>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} autoComplete="name" autoFocus />
          </Field>
          <NewPasswordFields policy={policy} onChange={setPassword} />
          <Alert tone="info">{t("master_password_warning")}</Alert>
          <Button type="submit" variant="primary" block busy={action.busy} disabled={!password.valid}>
            {action.busy ? t("deriving_keys") : t("create_vault")}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function RecoverPage() {
  const { t } = useI18n();
  const { policy, start } = useSession();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState<NewPassword>({ value: "", valid: false });
  const [newCode, setNewCode] = useState<string | null>(null);
  const action = useAction();
  if (!policy) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const recoveryKeys = await deriveRecoveryKeys(code);
      const started = await api.recoverStart(recoveryKeys.authKey);
      const result = await recoverAccount(code, started.recovery_wrapped_vault_key, password.value, started.policy);
      await api.recoverFinish(result.body);
      setNewCode(result.newRecoveryCode);
    });
  };

  const finish = () => {
    navigate("", true);
    void start();
  };

  return (
    <AuthShell title={t("recover_title")} subtitle={newCode ? t("recover_done") : t("recover_subtitle")}>
      {newCode ? (
        <RecoveryCodePanel code={newCode} onDone={finish} />
      ) : (
        <>
          <form className="stack" onSubmit={submit}>
            {action.error && <Alert tone="error">{action.error}</Alert>}
            <Field label={t("recovery_code")} hint={t("recovery_code_hint")}>
              <input
                className="input mono"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                required
              />
            </Field>
            <NewPasswordFields policy={policy} onChange={setPassword} />
            <Button type="submit" variant="primary" block busy={action.busy} disabled={!password.valid}>
              {t("reset_password")}
            </Button>
          </form>
          <div className="auth-links">
            <a href="#/">{t("back_to_unlock")}</a>
          </div>
        </>
      )}
    </AuthShell>
  );
}
