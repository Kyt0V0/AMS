import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ExternalLink,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import { api, type DirectoryUser, type ShareRecipient } from "../lib/api";
import { DEFAULT_GENERATOR, generatePassword, passwordStrength, type GeneratorOptions } from "../lib/password";
import { ageInDays } from "../lib/dates";
import { navigate } from "../lib/router";
import {
  createEntry,
  EMPTY_ENTRY,
  rotateEntryKey,
  shareEntry,
  updateEntry,
  type Entry,
  type EntryData,
  type EntryHealth,
} from "../lib/vault";
import { KeyFingerprint } from "../components/KeyFingerprint";
import { useI18n, type Translate } from "../i18n";
import { useUnlocked } from "../state/session";
import { useVault } from "../state/vault";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  Field,
  IconButton,
  Modal,
  PasswordInput,
  Spinner,
  StrengthMeter,
  useAction,
  useCopy,
  useToast,
} from "../components/ui";

type Filter = "all" | "mine" | "shared" | "attention";

function needsAttention(health: EntryHealth | undefined): boolean {
  return !!health && (health.weak || health.reused || health.old);
}

export function HealthBadges({ health, t }: { health: EntryHealth | undefined; t: Translate }) {
  if (!health) return null;
  return (
    <>
      {health.weak && <Badge tone="danger">{t("health_weak")}</Badge>}
      {health.reused && <Badge tone="warn">{t("health_reused")}</Badge>}
      {health.old && <Badge tone="warn">{t("health_old")}</Badge>}
    </>
  );
}

function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export default function VaultPage({ selectedId }: { selectedId?: string }) {
  const { t } = useI18n();
  const { user } = useUnlocked();
  const { entries, health, loading, error, reload } = useVault();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);
  const copy = useCopy();
  const canEdit = user.role !== "viewer";

  const counts = useMemo(
    () => ({
      all: entries.length,
      mine: entries.filter((e) => e.isOwner).length,
      shared: entries.filter((e) => !e.isOwner).length,
      attention: entries.filter((e) => e.isOwner && needsAttention(health.get(e.id))).length,
    }),
    [entries, health],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === "mine" && !entry.isOwner) return false;
      if (filter === "shared" && entry.isOwner) return false;
      if (filter === "attention" && !(entry.isOwner && needsAttention(health.get(entry.id)))) return false;
      if (!needle) return true;
      const d = entry.data;
      return [d?.title, d?.system, d?.username, d?.url, entry.ownerName].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [entries, health, query, filter]);

  const selected = selectedId ? entries.find((entry) => entry.id === selectedId) : undefined;
  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: t("filter_all") },
    { id: "mine", label: t("filter_mine") },
    { id: "shared", label: t("filter_shared") },
    { id: "attention", label: t("filter_attention") },
  ];

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{t("nav_vault")}</h1>
          <p className="muted">{t("vault_subtitle")}</p>
        </div>
        {canEdit && (
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            {t("new_entry")}
          </Button>
        )}
      </header>

      <div className="toolbar">
        <span className="search">
          <Search aria-hidden="true" />
          <input
            className="input"
            type="search"
            placeholder={t("search_placeholder")}
            aria-label={t("search_placeholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </span>
        <div className="chips" role="tablist">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={filter === item.id ? "chip on" : "chip"}
              onClick={() => setFilter(item.id)}
            >
              {item.label} <span className="chip-count">{counts[item.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <div className="center-block">
          <Spinner large />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<KeyRound />} title={entries.length === 0 ? t("vault_empty_title") : t("no_matches")}>
          {entries.length === 0 && <p className="muted">{t(canEdit ? "vault_empty_body" : "vault_empty_viewer")}</p>}
        </EmptyState>
      ) : (
        <ul className="entry-list">
          {visible.map((entry) => (
            <li key={entry.id}>
              <button type="button" className="entry-row" onClick={() => navigate(`vault/${entry.id}`)}>
                <Avatar name={entry.data?.title || "?"} />
                <span className="entry-main">
                  <strong>{entry.data ? entry.data.title : t("entry_unreadable")}</strong>
                  <span className="muted">{[entry.data?.system, entry.data?.username].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="entry-tags">
                  {entry.isOwner && <HealthBadges health={health.get(entry.id)} t={t} />}
                  {!entry.isOwner && <Badge tone="accent">{t("shared_by", { name: entry.ownerName })}</Badge>}
                  {entry.isOwner && entry.sharedWith > 0 && (
                    <Badge>
                      <Users /> {entry.sharedWith}
                    </Badge>
                  )}
                </span>
              </button>
              {entry.data?.password && (
                <IconButton label={t("copy_password")} onClick={() => void copy(entry.data!.password, true)}>
                  <KeyRound />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {creating && <EntryForm onClose={() => setCreating(false)} onSaved={reload} />}
      {selected && <EntryDrawer key={selected.id} entry={selected} health={health.get(selected.id)} />}
    </section>
  );
}

function DetailRow({ label, value, secret = false, link }: { label: string; value: string; secret?: boolean; link?: string | null }) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  if (!value) return null;
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={secret ? "detail-value mono" : "detail-value"} dir="auto">{secret && !revealed ? "••••••••••••" : value}</span>
      <span className="detail-actions">
        {secret && (
          <Button small variant="ghost" onClick={() => setRevealed((v) => !v)}>
            {t(revealed ? "hide" : "show")}
          </Button>
        )}
        {link && (
          <a className="icon-btn" href={link} target="_blank" rel="noopener noreferrer" aria-label={t("open_link")} title={t("open_link")}>
            <ExternalLink />
          </a>
        )}
        <CopyButton value={value} secret={secret} />
      </span>
    </div>
  );
}

function EntryDrawer({ entry, health }: { entry: Entry; health: EntryHealth | undefined }) {
  const { t, formatDate } = useI18n();
  const { keys, user } = useUnlocked();
  const { reload } = useVault();
  const toast = useToast();
  const [mode, setMode] = useState<"view" | "edit" | "share" | "delete" | "leave" | "rotate">("view");
  const close = () => navigate("vault");
  const data = entry.data;
  const age = ageInDays(data?.passwordChangedAt ?? "");
  const canManage = entry.isOwner && user.role !== "viewer";
  const canEdit = canManage && !!data;

  if (mode === "edit") return <EntryForm entry={entry} onClose={() => setMode("view")} onSaved={reload} />;
  if (mode === "share") return <ShareDialog entry={entry} onClose={() => setMode("view")} />;

  return (
    <>
      <Modal
        variant="drawer"
        title={data ? data.title : t("entry_unreadable")}
        onClose={close}
        footer={
          canManage ? (
            <>
              <Button variant="danger" icon={<Trash2 />} onClick={() => setMode("delete")}>
                {t("delete")}
              </Button>
              <span className="spacer" />
              {data && (
                <Button icon={<Share2 />} onClick={() => setMode("share")}>
                  {t("share")}
                </Button>
              )}
              {canEdit && (
                <Button variant="primary" icon={<Pencil />} onClick={() => setMode("edit")}>
                  {t("edit")}
                </Button>
              )}
            </>
          ) : entry.isOwner ? undefined : (
            <Button icon={<UserMinus />} onClick={() => setMode("leave")}>
              {t("remove_from_vault")}
            </Button>
          )
        }
      >
        {!data ? (
          <Alert tone="error">{t("entry_unreadable_body")}</Alert>
        ) : (
          <div className="stack">
            <div className="tag-line">
              {entry.isOwner ? <HealthBadges health={health} t={t} /> : <Badge tone="accent">{t("shared_by", { name: entry.ownerName })}</Badge>}
              {!entry.isOwner && <Badge>{t("read_only")}</Badge>}
            </div>
            <div className="details">
              <DetailRow label={t("field_system")} value={data.system} />
              <DetailRow label={t("username")} value={data.username} />
              <DetailRow label={t("password")} value={data.password} secret />
              <DetailRow label={t("field_url")} value={data.url} link={safeUrl(data.url)} />
            </div>
            {data.notes && (
              <div className="notes">
                <span className="detail-label">{t("field_notes")}</span>
                <p dir="auto">{data.notes}</p>
              </div>
            )}
            <dl className="meta">
              <dt>{t("password_age")}</dt>
              <dd>{age === null ? "–" : age === 0 ? t("today") : t("days_ago", { count: age })}</dd>
              <dt>{t("last_updated")}</dt>
              <dd>{formatDate(entry.updatedAt)}</dd>
              <dt>{t("key_rotated")}</dt>
              <dd>{formatDate(entry.keyRotatedAt)}</dd>
              {entry.isOwner && (
                <>
                  <dt>{t("shared_with")}</dt>
                  <dd>{t("people_count", { count: entry.sharedWith })}</dd>
                </>
              )}
            </dl>
            {canManage && (
              <Button small variant="ghost" icon={<RefreshCw />} onClick={() => setMode("rotate")}>
                {t("rotate_key")}
              </Button>
            )}
          </div>
        )}
      </Modal>

      {mode === "delete" && (
        <ConfirmDialog
          title={t("delete_entry_title")}
          confirmLabel={t("delete")}
          onClose={() => setMode("view")}
          onConfirm={async () => {
            await api.deleteCredential(entry.id);
            toast(t("entry_deleted"));
            close();
            await reload();
          }}
        >
          <p>{t("delete_entry_body", { title: data?.title ?? "" })}</p>
        </ConfirmDialog>
      )}
      {mode === "leave" && (
        <ConfirmDialog
          title={t("remove_from_vault")}
          confirmLabel={t("remove")}
          onClose={() => setMode("view")}
          onConfirm={async () => {
            await api.leaveShare(entry.id);
            close();
            await reload();
          }}
        >
          <p>{t("leave_share_body", { name: entry.ownerName })}</p>
        </ConfirmDialog>
      )}
      {mode === "rotate" && (
        <ConfirmDialog
          title={t("rotate_key")}
          confirmLabel={t("rotate_key")}
          danger={false}
          onClose={() => setMode("view")}
          onConfirm={async () => {
            const recipients = entry.sharedWith > 0 ? await api.shares(entry.id) : [];
            await rotateEntryKey(keys, entry, recipients);
            toast(t("key_rotated_done"));
            await reload();
          }}
        >
          <p>{t("rotate_key_body")}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function Generator({ onUse }: { onUse: (password: string) => void }) {
  const { t } = useI18n();
  const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_GENERATOR);
  const set = (patch: Partial<GeneratorOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    onUse(generatePassword(next));
  };
  const kinds: { key: "lower" | "upper" | "digits" | "symbols"; label: string }[] = [
    { key: "lower", label: "a–z" },
    { key: "upper", label: "A–Z" },
    { key: "digits", label: "0–9" },
    { key: "symbols", label: "!@#" },
  ];
  return (
    <div className="generator">
      <label className="range">
        <span>{t("length")}</span>
        <input type="range" min={8} max={64} value={options.length} onChange={(event) => set({ length: Number(event.target.value) })} />
        <output>{options.length}</output>
      </label>
      <div className="generator-kinds">
        {kinds.map((kind) => (
          <label key={kind.key} className="check">
            <input type="checkbox" checked={options[kind.key]} onChange={(event) => set({ [kind.key]: event.target.checked })} />
            <span className="mono">{kind.label}</span>
          </label>
        ))}
        <Button small icon={<RefreshCw />} onClick={() => onUse(generatePassword(options))}>
          {t("regenerate")}
        </Button>
      </div>
    </div>
  );
}

function EntryForm({ entry, onClose, onSaved }: { entry?: Entry; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const { keys, user } = useUnlocked();
  const toast = useToast();
  const [data, setData] = useState<EntryData>(entry?.data ?? EMPTY_ENTRY);
  const [showGenerator, setShowGenerator] = useState(false);
  const action = useAction();
  const set = (patch: Partial<EntryData>) => setData((current) => ({ ...current, ...patch }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const clean = { ...data, title: data.title.trim(), system: data.system.trim(), url: data.url.trim() };
      if (entry) await updateEntry(keys, entry, clean);
      else await createEntry(keys, user.id, clean);
      toast(t("saved"));
      onClose();
      await onSaved();
    });
  };

  return (
    <Modal
      title={entry ? t("edit_entry") : t("new_entry")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button type="submit" form="entry-form" variant="primary" busy={action.busy}>
            {t("save")}
          </Button>
        </>
      }
    >
      <form id="entry-form" className="stack" onSubmit={submit}>
        {action.error && <Alert tone="error">{action.error}</Alert>}
        <Field label={t("field_title")}>
          <input className="input" value={data.title} onChange={(event) => set({ title: event.target.value })} maxLength={120} autoFocus required />
        </Field>
        <div className="grid-2">
          <Field label={t("field_system")}>
            <input className="input" value={data.system} onChange={(event) => set({ system: event.target.value })} maxLength={120} />
          </Field>
          <Field label={t("username")}>
            <input
              className="input"
              value={data.username}
              onChange={(event) => set({ username: event.target.value })}
              maxLength={200}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </Field>
        </div>
        <Field label={t("password")}>
          <PasswordInput value={data.password} onChange={(event) => set({ password: event.target.value })} maxLength={1000} />
          <span className="row-between">
            <StrengthMeter score={passwordStrength(data.password)} empty={!data.password} />
            <Button
              small
              variant="ghost"
              icon={<Sparkles />}
              onClick={() => {
                setShowGenerator(true);
                set({ password: generatePassword() });
              }}
            >
              {t("generate")}
            </Button>
          </span>
        </Field>
        {showGenerator && <Generator onUse={(password) => set({ password })} />}
        <Field label={t("field_url")}>
          <input className="input" value={data.url} onChange={(event) => set({ url: event.target.value })} maxLength={500} inputMode="url" spellCheck={false} />
        </Field>
        <Field label={t("field_notes")}>
          <textarea className="input" rows={4} value={data.notes} onChange={(event) => set({ notes: event.target.value })} maxLength={5000} />
        </Field>
        <p className="muted small">{t("entry_encrypted_note")}</p>
      </form>
    </Modal>
  );
}

function ShareDialog({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const { t } = useI18n();
  const { keys, user } = useUnlocked();
  const { reload, entries } = useVault();
  const toast = useToast();
  const [recipients, setRecipients] = useState<ShareRecipient[] | null>(null);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [chosen, setChosen] = useState("");
  const [revoking, setRevoking] = useState<ShareRecipient | null>(null);
  const action = useAction();
  const canShare = user.can_share && user.role !== "viewer";

  const current = entries.find((item) => item.id === entry.id) ?? entry;

  const load = async () => {
    setRecipients(await api.shares(entry.id));
    if (canShare) setDirectory(await api.directory());
  };
  useEffect(() => {
    void action.run(load);

  }, [entry.id]);

  const taken = new Set(recipients?.map((recipient) => recipient.recipient_id));
  const available = directory.filter((person) => !taken.has(person.id));
  const target = available.find((person) => person.id === chosen);

  const share = () =>
    action.run(async () => {
      if (!target) return;
      await shareEntry(keys, current, target);
      toast(t("shared_done", { name: target.username }));
      setChosen("");
      await Promise.all([load(), reload()]);
    });

  return (
    <>
      <Modal title={t("share_title", { title: current.data?.title ?? "" })} onClose={onClose} footer={<Button onClick={onClose}>{t("done")}</Button>}>
        <div className="stack">
          {action.error && <Alert tone="error">{action.error}</Alert>}
          <p className="muted">{t("share_explain")}</p>

          {canShare ? (
            <div className="share-add">
              <Field label={t("share_with")}>
                <select className="input" value={chosen} onChange={(event) => setChosen(event.target.value)}>
                  <option value="">{available.length ? t("choose_person") : t("nobody_to_share")}</option>
                  {available.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.username}
                    </option>
                  ))}
                </select>
              </Field>
              <Button variant="primary" icon={<Share2 />} disabled={!target} busy={action.busy && !!target} onClick={() => void share()}>
                {t("share")}
              </Button>
            </div>
          ) : (
            <Alert tone="info">{t("sharing_disabled")}</Alert>
          )}
          {target && (
            <Alert tone="info">
              {t("verify_fingerprint", { name: target.username })}
              <br />
              <KeyFingerprint publicKey={target.public_key} />
            </Alert>
          )}

          <h3 className="section-title">{t("people_with_access")}</h3>
          {recipients === null ? (
            <Spinner />
          ) : recipients.length === 0 ? (
            <p className="muted">{t("not_shared_yet")}</p>
          ) : (
            <ul className="people">
              {recipients.map((recipient) => (
                <li key={recipient.recipient_id}>
                  <Avatar name={recipient.username} />
                  <span className="entry-main">
                    <strong>{recipient.username}</strong>
                    <KeyFingerprint publicKey={recipient.public_key} />
                  </span>
                  <Button small variant="danger" onClick={() => setRevoking(recipient)}>
                    {t("revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      {revoking && recipients && (
        <ConfirmDialog
          title={t("revoke_title", { name: revoking.username })}
          confirmLabel={t("revoke")}
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            const keep = recipients.filter((recipient) => recipient.recipient_id !== revoking.recipient_id);
            await rotateEntryKey(keys, current, keep);
            toast(t("revoked_done", { name: revoking.username }));
            await Promise.all([load(), reload()]);
          }}
        >
          <p>{t("revoke_body")}</p>
          <Alert tone="warn">{t("revoke_warning")}</Alert>
        </ConfirmDialog>
      )}
    </>
  );
}
