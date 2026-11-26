import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LifeBuoy, Trash2 } from "lucide-react";
import { api, type ActivityRow, type Policy } from "../lib/api";
import { changePassword, proveCurrentPassword, replaceRecoveryCode } from "../lib/crypto";
import { deviceTimeZone } from "../lib/dates";
import { useI18n, type MessageKey } from "../i18n";
import { useUnlocked } from "../state/session";
import { Alert, Badge, Button, Field, Modal, PasswordInput, useAction, useToast } from "../components/ui";
import { NewPasswordFields, RecoveryCodeBox, type NewPassword } from "../components/PasswordFields";
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
  const { user, refresh } = useUnlocked();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const action = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await api.updateProfile(name.trim());
      await refresh();
      toast(t("saved"));
    });
  };

  return (
    <Card title={t("profile")}>
      <form className="stack" onSubmit={submit}>
        {action.error && <Alert tone="error">{action.error}</Alert>}
        <Field label={t("your_name")}>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} />
        </Field>
        <div className="row-end">
          <Button type="submit" variant="primary" busy={action.busy} disabled={name.trim() === user.name}>
            {t("save")}
          </Button>
        </div>
      </form>
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

function SecurityPreferencesCard() {
  const { t } = useI18n();
  const { policy: saved, refresh } = useUnlocked();
  const toast = useToast();
  const [policy, setPolicy] = useState<Policy>(saved);
  const action = useAction();

  const number = (key: keyof Policy, label: string, min: number, max: number, hint?: string, step = 1) => (
    <Field label={label} hint={hint}>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={policy[key]}
        onChange={(event) => setPolicy({ ...policy, [key]: Number(event.target.value) })}
        required
      />
    </Field>
  );

  const save = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      setPolicy(await api.updatePreferences(policy));
      await refresh();
      toast(t("saved"));
    });
  };

  return (
    <Card title={t("security_prefs")}>
      <form className="stack" onSubmit={save}>
        {action.error && <Alert tone="error">{action.error}</Alert>}
        <div className="grid-2">
          {number("vault_timeout_minutes", t("policy_timeout"), 1, 120, t("policy_timeout_hint"))}
          {number("password_max_age_days", t("policy_max_age"), 1, 3650, t("policy_max_age_hint"))}
        </div>
        <h3 className="section-title">{t("policy_kdf")}</h3>
        <p className="muted small">{t("policy_kdf_hint")}</p>
        <div className="grid-3">
          {number("kdf_memory_kib", t("policy_kdf_memory"), 19456, 1048576, `${Math.round(policy.kdf_memory_kib / 1024)} MiB`, 1024)}
          {number("kdf_time_cost", t("policy_kdf_time"), 2, 10)}
          {number("kdf_parallelism", t("policy_kdf_parallelism"), 1, 4)}
        </div>
        <div className="row-end">
          <Button type="submit" variant="primary" busy={action.busy}>
            {t("save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

const ACTIVITY_LABEL: Record<string, MessageKey> = {
  "vault.created": "act_vault_created",
  "unlock.ok": "act_unlock_ok",
  "unlock.failed": "act_unlock_failed",
  "password.changed": "act_password_changed",
  "recovery_code.replaced": "act_recovery_code_replaced",
  "recovery.ok": "act_recovery_ok",
  "recovery.failed": "act_recovery_failed",
};

function ActivityCard() {
  const { t, formatDate } = useI18n();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const action = useAction();
  const { run } = action;
  const load = useCallback(() => run(async () => setRows(await api.activity())), [run]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card title={t("activity")} description={`${t("activity_hint")} ${t("times_in_zone", { zone: deviceTimeZone() })}`}>
      {action.error && <Alert tone="error">{action.error}</Alert>}
      <ul className="people">
        {rows.map((row) => {
          const label = ACTIVITY_LABEL[row.action];
          return (
            <li key={row.id}>
              <span className="entry-main">
                <strong>{label ? t(label) : row.action}</strong>
                <span className="muted">{formatDate(row.at)}</span>
              </span>
              {row.action.endsWith(".failed") && <Badge tone="danger">!</Badge>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function AppearanceCard() {
  const { t } = useI18n();
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
    </Card>
  );
}

function DangerCard() {
  const { t } = useI18n();
  const { session, start } = useUnlocked();
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
            await api.deleteVault(await proveCurrentPassword(password, session));
            await start();
          }}
        />
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();
  const { user } = useUnlocked();

  const activityVersion = user.password_changed_at;
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
        <RecoveryCard />
        <SecurityPreferencesCard />
        <ActivityCard key={activityVersion} />
        <AppearanceCard />
        <DangerCard />
      </div>
    </section>
  );
}
