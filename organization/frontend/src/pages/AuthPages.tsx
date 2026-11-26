import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Download, KeyRound, Lock, ShieldCheck, Users } from "lucide-react";
import { api, type Policy, type Role } from "../lib/api";
import { createAccount, recoverAccount, deriveRecoveryKeys } from "../lib/crypto";
import { navigate } from "../lib/router";
import { useI18n } from "../i18n";
import { useSession } from "../state/session";
import { Alert, Avatar, Button, CodeInput, Field, PasswordInput, Spinner, useAction, useToast } from "../components/ui";
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
              <Users />
              <span>{t("brand_point_sharing")}</span>
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

function CodeStep({ emailHint }: { emailHint: string }) {
  const { t } = useI18n();
  const { verifyCode, resendCode, cancelChallenge } = useSession();
  const toast = useToast();
  const [code, setCode] = useState("");
  const action = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await verifyCode(code);
      navigate("vault", true);
    });
  };

  return (
    <AuthShell title={t("code_title")} subtitle={t("code_sent", { email: emailHint })}>
      <form className="stack" onSubmit={submit}>
        {action.error && <Alert tone="error">{action.error}</Alert>}
        <Field label={t("code_label")}>
          <CodeInput value={code} onChange={setCode} />
        </Field>
        <Button type="submit" variant="primary" block busy={action.busy} disabled={code.length !== 6}>
          {t("verify")}
        </Button>
      </form>
      <div className="auth-links">
        <button
          type="button"
          className="link"
          onClick={() =>
            void action.run(async () => {
              await resendCode();
              setCode("");
              toast(t("code_resent"));
            })
          }
        >
          {t("resend_code")}
        </button>
        <button type="button" className="link" onClick={cancelChallenge}>
          {t("back_to_sign_in")}
        </button>
      </div>
    </AuthShell>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const { signIn, expired, policy, challenge } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const action = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await signIn(username.trim(), password);
      setPassword("");
    });
  };

  if (challenge) return <CodeStep emailHint={challenge.emailHint} />;

  return (
    <AuthShell title={t("sign_in")} subtitle={t("sign_in_subtitle")}>
      <form className="stack" onSubmit={submit}>
        {expired && !action.error && <Alert tone="info">{t("session_ended")}</Alert>}
        {action.error && <Alert tone="error">{action.error}</Alert>}
        <Field label={t("username")}>
          <input
            className="input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            required
          />
        </Field>
        <Field label={t("master_password")}>
          <PasswordInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Button type="submit" variant="primary" block busy={action.busy}>
          {action.busy ? t("deriving_keys") : t("sign_in")}
        </Button>
      </form>
      <div className="auth-links">
        <a href="#/recover">{t("forgot_password")}</a>
        {policy?.open_registration && <a href="#/join">{t("create_account")}</a>}
      </div>
    </AuthShell>
  );
}

export function UnlockPage() {
  const { t } = useI18n();
  const { session, unlock, signOut } = useSession();
  const [password, setPassword] = useState("");
  const action = useAction();
  const name = session?.user.username ?? "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(() => unlock(password));
  };

  return (
    <AuthShell title={t("unlock_title")} subtitle={t("unlock_subtitle")}>
      <div className="identity">
        <Avatar name={name} large />
        <div>
          <strong>{name}</strong>
          <span className="muted">{session?.user.email}</span>
        </div>
      </div>
      <form className="stack" onSubmit={submit}>
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
        <button type="button" className="link" onClick={() => void signOut()}>
          {t("sign_out_instead")}
        </button>
      </div>
    </AuthShell>
  );
}

function RecoveryCodePanel({ code, username, onDone }: { code: string; username: string; onDone: () => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);

  const download = () => {
    const text = `AMS recovery code\nAccount: ${username}\nCode: ${code}\n\n${t("recovery_file_note")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ams-recovery-code-${username}.txt`;
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

function AccountForm({
  policy,
  withSetupToken,
  inviteToken,
  submitLabel,
}: {
  policy: Policy;
  withSetupToken?: boolean;
  inviteToken?: string;
  submitLabel: string;
}) {
  const { t } = useI18n();
  const { start } = useSession();
  const [setupToken, setSetupToken] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState<NewPassword>({ value: "", valid: false });
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [tokenFilled, setTokenFilled] = useState(false);
  const action = useAction();

  useEffect(() => {
    if (!withSetupToken) return;
    let cancelled = false;
    api.localSetupToken().then(
      (result) => {
        if (cancelled) return;
        setSetupToken((current) => current || result.token);
        setTokenFilled(true);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [withSetupToken]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const { account, recoveryCode: code } = await createAccount(password.value, policy);
      const body = { ...account, username: username.trim(), email: email.trim() };
      if (withSetupToken) await api.setup({ ...body, setup_token: setupToken.trim() });
      else await api.register({ ...body, invite_token: inviteToken });
      setRecoveryCode(code);
    });
  };

  if (recoveryCode) {
    return (
      <RecoveryCodePanel
        code={recoveryCode}
        username={username.trim()}
        onDone={() => {
          navigate("", true);
          void start();
        }}
      />
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      {action.error && <Alert tone="error">{action.error}</Alert>}
      {withSetupToken && (
        <Field label={t("setup_token")} hint={t(tokenFilled ? "setup_token_auto" : "setup_token_hint")}>
          <input
            className="input mono"
            value={setupToken}
            onChange={(event) => setSetupToken(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </Field>
      )}
      <Field label={t("username")} hint={t("username_rule")}>
        <input
          className="input"
          autoFocus={withSetupToken}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          pattern="[A-Za-z0-9._\-]{3,32}"
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          required
        />
      </Field>
      <Field label={t("email")}>
        <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
      </Field>
      <NewPasswordFields policy={policy} onChange={setPassword} />
      <Alert tone="info">{t("master_password_warning")}</Alert>
      <Button type="submit" variant="primary" block busy={action.busy} disabled={!password.valid}>
        {action.busy ? t("deriving_keys") : submitLabel}
      </Button>
    </form>
  );
}

export function SetupPage() {
  const { t } = useI18n();
  const { policy } = useSession();
  if (!policy) return null;
  return (
    <AuthShell title={t("setup_title")} subtitle={t("setup_subtitle")}>
      <AccountForm policy={policy} withSetupToken submitLabel={t("create_admin")} />
    </AuthShell>
  );
}

export function JoinPage({ token }: { token?: string }) {
  const { t } = useI18n();
  const { policy } = useSession();
  const [invite, setInvite] = useState<{ role: Role } | "invalid" | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.checkInvite(token).then(
      (result) => !cancelled && setInvite(result),
      () => !cancelled && setInvite("invalid"),
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!policy) return null;
  const blocked = token ? invite === "invalid" : !policy.open_registration;

  return (
    <AuthShell title={t("join_title")} subtitle={t("join_subtitle")}>
      {token && invite === null ? (
        <Spinner large />
      ) : blocked ? (
        <Alert tone="warn">{t(token ? "invite_invalid" : "invite_required")}</Alert>
      ) : (
        <>
          {invite && invite !== "invalid" && <Alert tone="ok">{t("invite_valid", { role: t(`role_${invite.role}`) })}</Alert>}
          <AccountForm policy={policy} inviteToken={token} submitLabel={t("create_account")} />
        </>
      )}
      <div className="auth-links">
        <a href="#/">{t("back_to_sign_in")}</a>
      </div>
    </AuthShell>
  );
}

export function RecoverPage() {
  const { t } = useI18n();
  const { policy, start } = useSession();
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState<NewPassword>({ value: "", valid: false });
  const [newCode, setNewCode] = useState<string | null>(null);
  const action = useAction();

  if (!policy) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const name = username.trim();
      const recoveryKeys = await deriveRecoveryKeys(code);
      const started = await api.recoverStart(name, recoveryKeys.authKey);
      const result = await recoverAccount(code, started.recovery_wrapped_vault_key, password.value, started.policy);
      await api.recoverFinish({ username: name, ...result.body });
      setNewCode(result.newRecoveryCode);
    });
  };

  return (
    <AuthShell title={t("recover_title")} subtitle={newCode ? t("recover_done") : t("recover_subtitle")}>
      {newCode ? (
        <RecoveryCodePanel
          code={newCode}
          username={username.trim()}
          onDone={() => {
            navigate("", true);
            void start();
          }}
        />
      ) : (
        <form className="stack" onSubmit={submit}>
          {action.error && <Alert tone="error">{action.error}</Alert>}
          <Field label={t("username")}>
            <input
              className="input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              required
            />
          </Field>
          <Field label={t("recovery_code")} hint={t("recovery_code_hint")}>
            <input
              className="input mono"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </Field>
          <NewPasswordFields policy={policy} onChange={setPassword} />
          <Button type="submit" variant="primary" block busy={action.busy} disabled={!password.valid}>
            {t("reset_password")}
          </Button>
        </form>
      )}
      {!newCode && (
        <div className="auth-links">
          <a href="#/">{t("back_to_sign_in")}</a>
        </div>
      )}
    </AuthShell>
  );
}
