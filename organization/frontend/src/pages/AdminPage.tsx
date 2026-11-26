import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, KeyRound, LogOut, MailPlus, Share2, ShieldAlert, Trash2, UserCheck, Users } from "lucide-react";
import { api, type AdminUser, type AuditRow, type Invite, type Overview, type Policy, type Role } from "../lib/api";
import { deviceTimeZone } from "../lib/dates";
import { navigate } from "../lib/router";
import { useI18n } from "../i18n";
import { useUnlocked } from "../state/session";
import { Alert, Avatar, Badge, Button, ConfirmDialog, CopyButton, Field, IconButton, Spinner, Toggle, useAction, useToast } from "../components/ui";

const ROLES: Role[] = ["admin", "editor", "viewer"];
const TABS = ["overview", "people", "invites", "policy", "activity"] as const;
type Tab = (typeof TABS)[number];

function useLoader<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const action = useAction();
  const { run } = action;
  const reload = useCallback(() => run(async () => setData(await loader())), [run, loader]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, reload, error: action.error, run };
}

function Loading({ error }: { error: string | null }) {
  return error ? <Alert tone="error">{error}</Alert> : <div className="center-block"><Spinner large /></div>;
}

function OverviewTab() {
  const { t } = useI18n();
  const { data, error } = useLoader<Overview>(api.adminOverview);
  if (!data) return <Loading error={error} />;
  const stats: { icon: React.ReactNode; value: number; label: string; tone?: string }[] = [
    { icon: <Users />, value: data.active_users, label: t("stat_active_users") },
    { icon: <UserCheck />, value: data.admins, label: t("stat_admins") },
    { icon: <KeyRound />, value: data.entries, label: t("stat_entries") },
    { icon: <Share2 />, value: data.shares, label: t("stat_shares") },
    { icon: <LogOut />, value: data.sessions, label: t("stat_sessions") },
    { icon: <MailPlus />, value: data.pending_invites, label: t("stat_invites") },
    { icon: <ShieldAlert />, value: data.failed_logins_24h, label: t("stat_failed_logins"), tone: data.failed_logins_24h > 0 ? "warn" : "ok" },
  ];
  return (
    <div className="stack">
      <div className="stats">
        {stats.map((stat) => (
          <div key={stat.label} className={`stat stat-${stat.tone ?? "neutral"}`}>
            <span className="stat-icon">{stat.icon}</span>
            <strong>{stat.value}</strong>
            <span className="muted">{stat.label}</span>
          </div>
        ))}
      </div>
      <Alert tone="info">{t("admin_zero_knowledge")}</Alert>
    </div>
  );
}

function PeopleTab() {
  const { t, formatDate } = useI18n();
  const { user: me } = useUnlocked();
  const toast = useToast();
  const { data: users, reload, error, run } = useLoader<AdminUser[]>(api.adminUsers);
  const [removing, setRemoving] = useState<AdminUser | null>(null);
  if (!users) return <Loading error={error} />;

  const update = (target: AdminUser, change: Parameters<typeof api.adminUpdateUser>[1]) =>
    void run(async () => {
      await api.adminUpdateUser(target.id, change);
      await reload();
    });

  return (
    <div className="stack">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("user")}</th>
              <th>{t("role")}</th>
              <th>{t("col_active")}</th>
              <th>{t("col_can_share")}</th>
              <th>{t("col_can_edit_profile")}</th>
              <th>{t("col_two_factor")}</th>
              <th>{t("col_entries")}</th>
              <th>{t("col_last_login")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((person) => {
              const self = person.id === me.id;
              return (
                <tr key={person.id} className={person.is_active ? "" : "row-muted"}>
                  <td>
                    <span className="cell-user">
                      <Avatar name={person.username} />
                      <span className="entry-main">
                        <strong>
                          {person.username} {self && <Badge tone="accent">{t("you")}</Badge>}
                        </strong>
                        <span className="muted">{person.email}</span>
                      </span>
                    </span>
                  </td>
                  <td>
                    <select
                      className="input input-sm"
                      aria-label={t("role")}
                      value={person.role}
                      disabled={self}
                      onChange={(event) => update(person, { role: event.target.value as Role })}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {t(`role_${role}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <Toggle label={t("col_active")} checked={person.is_active} disabled={self} onChange={(value) => update(person, { is_active: value })} />
                  </td>
                  <td>
                    <Toggle label={t("col_can_share")} checked={person.can_share} disabled={person.role === "viewer"} onChange={(value) => update(person, { can_share: value })} />
                  </td>
                  <td>
                    <Toggle label={t("col_can_edit_profile")} checked={person.can_edit_profile} onChange={(value) => update(person, { can_edit_profile: value })} />
                  </td>
                  <td>
                    <Toggle
                      label={t("col_two_factor")}
                      checked={person.two_factor_enabled}
                      disabled={!person.two_factor_enabled}
                      onChange={() => update(person, { two_factor_enabled: false })}
                    />
                  </td>
                  <td>{person.entries}</td>
                  <td className="nowrap">{formatDate(person.last_login_at)}</td>
                  <td className="cell-actions">
                    <IconButton
                      label={t("sign_out_everywhere")}
                      onClick={() =>
                        void run(async () => {
                          const result = await api.adminRevokeSessions(person.id);
                          toast(t("sessions_revoked", { count: result.revoked }));
                        })
                      }
                    >
                      <LogOut />
                    </IconButton>
                    <IconButton label={t("delete_user")} disabled={self} onClick={() => setRemoving(person)}>
                      <Trash2 />
                    </IconButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t("roles_explained")}</p>

      {removing && (
        <ConfirmDialog
          title={t("delete_user_title", { name: removing.username })}
          confirmLabel={t("delete_user")}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.adminDeleteUser(removing.id);
            await reload();
          }}
        >
          <p>{t("delete_user_body", { count: removing.entries })}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function InvitesTab() {
  const { t, formatDate } = useI18n();
  const { data: invites, reload, error, run } = useLoader<Invite[]>(api.adminInvites);
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [days, setDays] = useState(7);
  const [link, setLink] = useState<string | null>(null);

  const create = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const invite = await api.adminCreateInvite({ label: label.trim(), role, expires_in_days: days });
      setLink(`${window.location.origin}/#/join/${invite.token}`);
      setLabel("");
      await reload();
    });
  };

  const tone = { pending: "ok", used: "neutral", expired: "warn" } as const;
  return (
    <div className="stack">
      {error && <Alert tone="error">{error}</Alert>}
      <form className="card" onSubmit={create}>
        <h2>{t("invite_someone")}</h2>
        <p className="muted">{t("invite_explain")}</p>
        <div className="grid-3">
          <Field label={t("invite_label")}>
            <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder={t("invite_label_placeholder")} />
          </Field>
          <Field label={t("role")}>
            <select className="input" value={role} onChange={(event) => setRole(event.target.value as Role)}>
              {ROLES.map((item) => (
                <option key={item} value={item}>
                  {t(`role_${item}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("invite_valid_days")}>
            <input className="input" type="number" min={1} max={30} value={days} onChange={(event) => setDays(Number(event.target.value))} required />
          </Field>
        </div>
        <div className="row-end">
          <Button type="submit" variant="primary" icon={<MailPlus />}>
            {t("create_invite")}
          </Button>
        </div>
        {link && (
          <Alert tone="ok">
            {t("invite_link_ready")}
            <div className="code-box">
              <code>{link}</code>
              <CopyButton value={link} />
            </div>
          </Alert>
        )}
      </form>

      {!invites ? (
        <Loading error={null} />
      ) : invites.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("invite_label")}</th>
                <th>{t("role")}</th>
                <th>{t("status")}</th>
                <th>{t("expires")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.label || "–"}</td>
                  <td>{t(`role_${invite.role}`)}</td>
                  <td>
                    <Badge tone={tone[invite.status]}>{t(`invite_${invite.status}`)}</Badge>
                  </td>
                  <td className="nowrap">{formatDate(invite.expires_at)}</td>
                  <td className="cell-actions">
                    <IconButton
                      label={t("delete")}
                      onClick={() =>
                        void run(async () => {
                          await api.adminRevokeInvite(invite.id);
                          await reload();
                        })
                      }
                    >
                      <Trash2 />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function PolicyTab() {
  const { t } = useI18n();
  const { refresh, mailEnabled } = useUnlocked();
  const toast = useToast();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const action = useAction();
  const { run } = action;

  useEffect(() => {
    void run(async () => setPolicy(await api.adminPolicy()));
  }, [run]);
  if (!policy) return <Loading error={action.error} />;

  const number = (key: keyof Policy, label: string, min: number, max: number, hint?: string, step = 1) => (
    <Field label={label} hint={hint}>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={policy[key] as number}
        onChange={(event) => setPolicy({ ...policy, [key]: Number(event.target.value) })}
        required
      />
    </Field>
  );

  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      setPolicy(await api.adminUpdatePolicy(policy));
      await refresh();
      toast(t("saved"));
    });
  };

  return (
    <form className="stack" onSubmit={save}>
      {action.error && <Alert tone="error">{action.error}</Alert>}
      <section className="card">
        <h2>{t("policy_access")}</h2>
        <div className="pref-row">
          <span>
            {t("policy_open_registration")}
            <small className="muted block">{t("policy_open_registration_hint")}</small>
          </span>
          <Toggle label={t("policy_open_registration")} checked={policy.open_registration} onChange={(value) => setPolicy({ ...policy, open_registration: value })} />
        </div>
        <div className="pref-row">
          <span>
            {t("policy_require_two_factor")}
            <small className="muted block">{t(mailEnabled ? "policy_require_two_factor_hint" : "two_factor_no_mail")}</small>
          </span>
          <Toggle
            label={t("policy_require_two_factor")}
            checked={policy.require_two_factor}
            disabled={!mailEnabled && !policy.require_two_factor}
            onChange={(value) => setPolicy({ ...policy, require_two_factor: value })}
          />
        </div>
        <div className="grid-3">
          {number("min_password_length", t("policy_min_length"), 10, 64)}
          {number("password_max_age_days", t("policy_max_age"), 1, 3650, t("policy_max_age_hint"))}
          {number("vault_timeout_minutes", t("policy_timeout"), 1, 120, t("policy_timeout_hint"))}
        </div>
      </section>
      <section className="card">
        <h2>{t("policy_kdf")}</h2>
        <p className="muted">{t("policy_kdf_hint")}</p>
        <div className="grid-3">
          {number("kdf_memory_kib", t("policy_kdf_memory"), 19456, 1048576, `${Math.round(policy.kdf_memory_kib / 1024)} MiB`, 1024)}
          {number("kdf_time_cost", t("policy_kdf_time"), 2, 10)}
          {number("kdf_parallelism", t("policy_kdf_parallelism"), 1, 4)}
        </div>
      </section>
      <div className="row-end">
        <Button type="submit" variant="primary" busy={action.busy}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

const PAGE_SIZE = 50;
const ACTION_GROUPS = ["", "auth.", "account.", "credential.", "admin."];

function ActivityTab() {
  const { t, formatDate } = useI18n();
  const [page, setPage] = useState(0);
  const [group, setGroup] = useState("");
  const [data, setData] = useState<{ total: number; items: AuditRow[] } | null>(null);
  const action = useAction();
  const { run } = action;

  useEffect(() => {
    void run(async () => setData(await api.adminAudit({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, action: group || undefined })));
  }, [run, page, group]);
  if (!data) return <Loading error={action.error} />;

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const tone = (name: string) => (name.includes("failed") || name.includes("blocked") ? "danger" : name.startsWith("admin.") ? "accent" : "neutral");

  return (
    <div className="stack">
      {action.error && <Alert tone="error">{action.error}</Alert>}
      <div className="toolbar">
        <div className="chips">
          {ACTION_GROUPS.map((prefix) => (
            <button
              key={prefix}
              type="button"
              className={group === prefix ? "chip on" : "chip"}
              onClick={() => {
                setGroup(prefix);
                setPage(0);
              }}
            >
              {prefix ? prefix.slice(0, -1) : t("filter_all")}
            </button>
          ))}
        </div>
        <span className="pager">
          <IconButton label={t("previous")} disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="flip-rtl" />
          </IconButton>
          <span className="muted">{t("page_of", { page: page + 1, pages })}</span>
          <IconButton label={t("next")} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            <ChevronRight className="flip-rtl" />
          </IconButton>
        </span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("col_time")}</th>
              <th>{t("user")}</th>
              <th>{t("col_action")}</th>
              <th>{t("col_details")}</th>
              <th>{t("col_address")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr key={row.id}>
                <td className="nowrap">{formatDate(row.at)}</td>
                <td>{row.actor ?? (row.actor_id ? t("deleted_user") : "–")}</td>
                <td>
                  <Badge tone={tone(row.action)}>{row.action}</Badge>
                </td>
                <td className="mono small">{row.detail ?? ""}</td>
                <td className="mono small">{row.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t("times_in_zone", { zone: deviceTimeZone() })}</p>
    </div>
  );
}

export default function AdminPage({ tab }: { tab?: string }) {
  const { t } = useI18n();
  const active: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : "overview";
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{t("nav_admin")}</h1>
          <p className="muted">{t("admin_subtitle")}</p>
        </div>
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map((name) => (
          <button key={name} type="button" role="tab" aria-selected={active === name} className={active === name ? "tab on" : "tab"} onClick={() => navigate(`admin/${name}`)}>
            {t(`admin_tab_${name}`)}
          </button>
        ))}
      </nav>
      {active === "overview" && <OverviewTab />}
      {active === "people" && <PeopleTab />}
      {active === "invites" && <InvitesTab />}
      {active === "policy" && <PolicyTab />}
      {active === "activity" && <ActivityTab />}
    </section>
  );
}
