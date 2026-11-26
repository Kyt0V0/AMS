import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Laptop, LifeBuoy, LogOut, MailCheck, Trash2 } from "lucide-react";
import { api, type DeviceSession } from "../lib/api";
import { changePassword, proveCurrentPassword, replaceRecoveryCode } from "../lib/crypto";
import { useI18n } from "../i18n";
import { useUnlocked } from "../state/session";
import { Alert, Badge, Button, CodePrompt, Field, Modal, PasswordInput, useAction, useToast } from "../components/ui";
import { NewPasswordFields, RecoveryCodeBox, type NewPassword } from "../components/PasswordFields";
import { KeyFingerprint } from "../components/KeyFingerprint";
import { LanguageSelect, ThemeSwitch } from "../components/Preferences";

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {description && <p className="muted">{description}</p>}
      {children}
    </section>
  );
}

function ProfileCard() {
  const { t } = useI18n();
  const { user, session, refresh, mailEnabled } = useUnlocked();
  const toast = useToast();
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [askingPassword, setAskingPassword] = useState(false);
  const [emailCodeSentTo, setEmailCodeSentTo] = useState<string | null>(null);
  const action = useAction();
  const locked = !user.can_edit_profile && user.role !== "admin";
  const dirty = username.trim() !== user.username || email.trim() !== user.email;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (email.trim() !== user.email) {
      setAskingPassword(true);
      return;
    }
    void action.run(async () => {
      await api.updateProfile({ username: username.trim() });
      await refresh();
      toast(t("saved"));
    });
  };

  const saveWithEmail = async (password: string) => {
    const authKey = await proveCurrentPassword(password, session);
    if (username.trim() !== user.username || !mailEnabled) {
      await api.updateProfile({
        username: username.trim(),
        ...(mailEnabled ? {} : { email: email.trim(), current_auth_key: authKey }),
      });
      await refresh();
    }
    if (mailEnabled) setEmailCodeSentTo((await api.startEmailChange(email.trim(), authKey)).email_hint);
    else toast(t("saved"));
    setAskingPassword(false);
  };

  return (
    <Card title={t("profile")} description={locked ? t("profile_locked") : undefined}>
      <form className="stack" onSubmit={submit}>
        {action.error && <Alert tone="error">{action.error}</Alert>}
        <div className="grid-2">
          <Field label={t("username")}>
            <input
              className="input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              pattern="[A-Za-z0-9._\-]{3,32}"
              disabled={locked}
              autoCapitalize="off"
              spellCheck={false}
              required
            />
          </Field>
          <Field label={t("email")}>
            <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={locked} required />
          </Field>
        </div>
        <div className="row-between">
          <Badge tone="accent">{t(`role_${user.role}`)}</Badge>
          <Button type="submit" variant="primary" busy={action.busy} disabled={locked || !dirty}>
            {t("save")}
          </Button>
        </div>
      </form>
      {askingPassword && (
        <PasswordPrompt
          title={t("email")}
          body={t("email_change_password_body")}
          confirmLabel={t("continue")}
          onClose={() => setAskingPassword(false)}
          onSubmit={saveWithEmail}
        />
      )}
      {emailCodeSentTo && (
        <CodePrompt
          title={t("email_verify_title")}
          emailHint={emailCodeSentTo}
          onClose={() => setEmailCodeSentTo(null)}
          onSubmit={async (code) => {
            await api.confirmEmailChange(code);
            await refresh();
            setEmailCodeSentTo(null);
            toast(t("saved"));
          }}
        />
      )}
    </Card>
  );
}

function TwoFactorCard() {
  const { t } = useI18n();
  const { user, session, policy, mailEnabled, refresh } = useUnlocked();
  const toast = useToast();
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const action = useAction();
  const required = policy.require_two_factor;
  const active = user.two_factor_enabled || required;

  return (
    <Card title={t("two_factor")} description={t("two_factor_hint")}>
      {action.error && <Alert tone="error">{action.error}</Alert>}
      {!mailEnabled && <Alert tone="warn">{t("two_factor_no_mail")}</Alert>}
      {required && <Alert tone="info">{t("two_factor_required_note")}</Alert>}
      <div className="row-between">
        <Badge tone={active ? "ok" : "neutral"}>{t(active ? "two_factor_on" : "two_factor_off")}</Badge>
        {user.two_factor_enabled ? (
          <Button onClick={() => setTurningOff(true)}>{t("two_factor_turn_off")}</Button>
        ) : (
          <Button
            variant="primary"
            icon={<MailCheck />}
            busy={action.busy}
            disabled={!mailEnabled}
            onClick={() => void action.run(async () => setCodeSentTo((await api.startTwoFactor()).email_hint))}
          >
            {t("two_factor_turn_on")}
          </Button>
        )}
      </div>
      {codeSentTo && (
        <CodePrompt
          title={t("two_factor")}
          emailHint={codeSentTo}
          onClose={() => setCodeSentTo(null)}
          onSubmit={async (code) => {
            await api.enableTwoFactor(code);
            await refresh();
            setCodeSentTo(null);
            toast(t("two_factor_enabled_done"));
          }}
        />
      )}
      {turningOff && (
        <PasswordPrompt
          title={t("two_factor_turn_off")}
          body={t("two_factor_off_body")}
          confirmLabel={t("two_factor_turn_off")}
          onClose={() => setTurningOff(false)}
          onSubmit={async (password) => {
            await api.disableTwoFactor(await proveCurrentPassword(password, session));
            await refresh();
            setTurningOff(false);
            toast(t("two_factor_disabled_done"));
          }}
        />
      )}
    </Card>
  );
}

function PasswordCard() {
  const { t, formatDay } = useI18n();
  const { session, policy, user, refresh } = useUnlocked();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState<NewPassword>({ value: "", valid: false });
  const [formKey, setFormKey] = useState(0);
  const action = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await api.changePassword(await changePassword(current, next.value, session, policy));
      await refresh();
      setCurrent("");
      setFormKey((key) => key + 1);
      toast(t("password_changed"));
    });
  };

  return (
    <Card title={t("master_password")} description={t("password_card_hint", { date: formatDay(user.password_changed_at) })}>
      <form className="stack" onSubmit={submit}>
        {action.error && <Alert tone="error">{action.error}</Alert>}
        <Field label={t("current_password")}>
          <PasswordInput value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required />
        </Field>
        <div className="grid-2">
          <NewPasswordFields key={formKey} policy={policy} onChange={setNext} />
        </div>
        <div className="row-end">
          <Button type="submit" variant="primary" busy={action.busy} disabled={!next.valid || !current}>
            {t("change_password")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordPrompt({
  title,
  body,
  confirmLabel,
  danger,
  onSubmit,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const action = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(() => onSubmit(password));
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button type="submit" form="password-prompt" variant={danger ? "danger" : "primary"} busy={action.busy} disabled={!password}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="password-prompt" className="stack" onSubmit={submit}>
        <p>{body}</p>
        {action.error && <Alert tone="error">{action.error}</Alert>}
        <Field label={t("master_password")}>
          <PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus required />
        </Field>
      </form>
    </Modal>
  );
}

function RecoveryCard() {
  const { t } = useI18n();
  const { session } = useUnlocked();
  const [asking, setAsking] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  return (
    <Card title={t("recovery_code")} description={t("recovery_card_hint")}>
      <div className="row-end">
        <Button icon={<LifeBuoy />} onClick={() => setAsking(true)}>
          {t("new_recovery_code")}
        </Button>
      </div>
      {asking && (
        <PasswordPrompt
          title={t("new_recovery_code")}
          body={t("new_recovery_code_body")}
          confirmLabel={t("continue")}
          onClose={() => setAsking(false)}
          onSubmit={async (password) => {
            const replacement = await replaceRecoveryCode(password, session);
            await api.replaceRecovery(replacement.body);
            setCode(replacement.code);
            setAsking(false);
          }}
        />
      )}
      {code && (
        <Modal title={t("recovery_code")} onClose={() => setCode(null)} footer={<Button variant="primary" onClick={() => setCode(null)}>{t("done")}</Button>}>
          <div className="stack">
            <RecoveryCodeBox code={code} />
          </div>
        </Modal>
      )}
    </Card>
  );
}

function describeAgent(agent: string | null): string {
  if (!agent) return "–";
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const system = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Mac OS X/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
  return system ? `${browser} · ${system}` : browser;
}

function SessionsCard() {
  const { t, formatDate } = useI18n();
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const action = useAction();
  const { run } = action;
  const load = useCallback(() => run(async () => setSessions(await api.sessions())), [run]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card title={t("devices")} description={t("devices_hint")}>
      {action.error && <Alert tone="error">{action.error}</Alert>}
      <ul className="people">
        {sessions.map((device) => (
          <li key={device.id}>
            <span className="avatar avatar-plain">
              <Laptop />
            </span>
            <span className="entry-main">
              <strong>
                {describeAgent(device.user_agent)} {device.current && <Badge tone="ok">{t("this_device")}</Badge>}
              </strong>
              <span className="muted">
                {device.ip} · {t("last_active", { date: formatDate(device.last_seen_at) })}
              </span>
            </span>
            {!device.current && (
              <Button
                small
                onClick={() =>
                  void run(async () => {
                    await api.revokeSession(device.id);
                    setSessions(await api.sessions());
                  })
                }
              >
                {t("sign_out")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 && (
        <div className="row-end">
          <Button
            icon={<LogOut />}
            onClick={() =>
              void run(async () => {
                await api.revokeOtherSessions();
                setSessions(await api.sessions());
              })
            }
          >
            {t("sign_out_others")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function PreferencesCard() {
  const { t } = useI18n();
  const { keys } = useUnlocked();

  return (
    <Card title={t("preferences")}>
      <div className="pref-row">
        <span>{t("language")}</span>
        <LanguageSelect />
      </div>
      <div className="pref-row">
        <span>{t("theme")}</span>
        <ThemeSwitch />
      </div>
      <div className="pref-row">
        <span>
          {t("your_fingerprint")}
          <small className="muted block">{t("your_fingerprint_hint")}</small>
        </span>
        <KeyFingerprint publicKey={keys.publicKey} />
      </div>
    </Card>
  );
}

function DangerCard() {
  const { t } = useI18n();
  const { session, signOut } = useUnlocked();
  const [asking, setAsking] = useState(false);
  return (
    <Card title={t("danger_zone")} description={t("delete_account_hint")}>
      <div className="row-end">
        <Button variant="danger" icon={<Trash2 />} onClick={() => setAsking(true)}>
          {t("delete_account")}
        </Button>
      </div>
      {asking && (
        <PasswordPrompt
          title={t("delete_account")}
          body={t("delete_account_body")}
          confirmLabel={t("delete_account")}
          danger
          onClose={() => setAsking(false)}
          onSubmit={async (password) => {
            await api.deleteAccount(await proveCurrentPassword(password, session));
            await signOut();
          }}
        />
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <section className="page page-narrow">
      <header className="page-head">
        <div>
          <h1>{t("nav_settings")}</h1>
          <p className="muted">{t("settings_subtitle")}</p>
        </div>
      </header>
      <div className="stack">
        <ProfileCard />
        <PasswordCard />
        <TwoFactorCard />
        <RecoveryCard />
        <SessionsCard />
        <PreferencesCard />
        <DangerCard />
      </div>
    </section>
  );
}
