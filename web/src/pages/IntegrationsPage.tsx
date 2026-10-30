import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  createToken,
  boot,
  remove,
  saveMe,
  tokens as listTokens,
  useMe,
  type ApiToken,
} from "../api";
import { Button, LinkButton } from "../components/Button";
import { Counter } from "../components/Counter";
import { Dialog } from "../components/Dialog";
import { Icon, type IconName } from "../components/Icon";
import { ConfirmDialog } from "../components/ProjectDialogs";
import { Section } from "../components/Section";
import { toast } from "../components/Toast";
import { useLang, useT } from "../i18n";
import { LIMITS } from "../limits";
import s from "./Table.module.css";
import own from "./IntegrationsPage.module.css";
import { formatDay } from "../format";
import { copyText } from "../browser";

const KINDS = ["assigned", "status", "comment"] as const;

export function IntegrationsPage() {
  const t = useT();
  const lang = useLang();
  const [list, setList] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState<"token" | "prompt" | "guide" | "fresh" | null>(null);
  const url = location.origin;
  const [confirming, setConfirming] = useState<string | null>(null);
  // Fetched ahead: Safari only lets a click write to the clipboard if nothing is awaited first.
  const [guide, setGuide] = useState<string>();
  const me = useMe()!;
  const bot = boot.bot;
  const [off, setOff] = useState(me.notify_off ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listTokens()
      .then(setList)
      .catch(() => toast(t("common.loadFailed")));
    fetch("/llms.txt")
      .then((r) => (r.ok ? r.text() : undefined))
      .then(setGuide)
      .catch(() => {});
  }, []);

  async function toggle(kind: string) {
    // Kinds the bot no longer knows (once "added") fall away with the next change.
    const known = off.filter((k) => KINDS.includes(k as (typeof KINDS)[number]));
    const next = known.includes(kind) ? known.filter((k) => k !== kind) : [...known, kind];
    setOff(next);
    setSaving(true);
    try {
      await saveMe(me, { notify_off: next });
    } catch {
      setOff(off);
      toast(t("common.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function copy(what: NonNullable<typeof copied>, text: string) {
    copyText(text)
      .then(() => {
        setCopied(what);
        setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
      })
      .catch(() => toast(t("common.copyFailed")));
  }
  const copyLabel = (what: typeof copied, label: string) =>
    copied === what ? t("common.copied") : label;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const created = await createToken(name.trim());
      setFresh({ name: created.name, token: created.token });
      setCopied(null);
      setName("");
      // Refetch instead of inserting the response: it carries the raw token.
      listTokens()
        .then(setList)
        .catch(() => toast(t("common.loadFailed")));
    } catch {
      toast(t("common.actionFailed"));
    }
  }

  async function revoke(id: string) {
    setConfirming(null);
    try {
      await remove("api_tokens", id);
      setList((xs) => xs && xs.filter((x) => x.id !== id));
    } catch {
      toast(t("common.actionFailed"));
    }
  }

  const revoking = list?.find((x) => x.id === confirming);

  return (
    <div className={s.page}>
      <div className={own.pair}>
        <Section title={t("api.title")}>
          <div className={own.card}>
            <form onSubmit={create}>
              <CardHead icon="key" title={t("tokens.createTitle")} />
              <div className={own.create}>
                <label className={own.name}>
                  <input
                    className="input"
                    required
                    aria-label={t("tokens.name")}
                    maxLength={LIMITS.tokenName}
                    placeholder={t("tokens.namePlaceholder")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Counter value={name} max={LIMITS.tokenName} />
                </label>
                <Button type="submit" variant="primary" icon="plus">
                  {t("common.create")}
                </Button>
              </div>
            </form>
            <div className={own.split} />
            <CardHead icon="bot" title={t("tokens.agentTitle")} text={t("tokens.promptText")}>
              <Button
                size="sm"
                icon="copy"
                aria-live="polite"
                onClick={() => copy("prompt", t("tokens.prompt", { url }))}
              >
                {copyLabel("prompt", t("tokens.copyPrompt"))}
              </Button>
            </CardHead>
            <div className={own.guide}>
              <Icon name="fileText" size={15} />
              <span className={own.file}>llms.txt</span>
              <Button
                size="sm"
                variant="ghost"
                icon={copied === "guide" ? "check" : "copy"}
                aria-label={copyLabel("guide", t("tokens.copyGuide"))}
                aria-live="polite"
                disabled={!guide}
                onClick={() => guide && copy("guide", guide)}
              />
              <LinkButton
                size="sm"
                icon="externalLink"
                aria-label={t("tokens.openGuide")}
                href="/llms.txt"
                target="_blank"
                rel="noopener"
              />
            </div>
          </div>
        </Section>

        {bot && (
          <Section title={t("bot.title")}>
            <div className={own.card}>
              <CardHead icon="telegramLine" title={`@${bot}`}>
                <LinkButton size="sm" href={`https://t.me/${bot}`} target="_blank" rel="noopener">
                  {t("bot.open")}
                </LinkButton>
              </CardHead>
              {KINDS.map((kind) => (
                <label key={kind} className={own.option}>
                  <span>{t(`bot.${kind}`)}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    className={own.switch}
                    checked={!off.includes(kind)}
                    disabled={saving}
                    onChange={() => toggle(kind)}
                  />
                </label>
              ))}
            </div>
          </Section>
        )}
      </div>

      <Section title={t("tokens.list")} count={list?.length}>
        {list?.length === 0 && <div className="empty">{t("tokens.empty")}</div>}
        {!!list?.length && (
          <div className={`${s.box} ${s.scroll}`}>
            <table className={`${s.table} ${s.cards}`}>
              <thead>
                <tr>
                  <th>{t("tokens.name")}</th>
                  <th>{t("tokens.token")}</th>
                  <th>{t("tokens.lastUsed")}</th>
                  <th className={s.right}>{t("users.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((tok) => (
                  <tr key={tok.id}>
                    <td>
                      <span className={s.name} title={tok.name}>
                        {tok.name}
                      </span>
                    </td>
                    <td className={`${s.mono} ${s.muted}`}>mbt_…{tok.hint}</td>
                    <td className={s.muted}>
                      {tok.last_used ? formatDay(tok.last_used, lang) : t("tokens.never")}
                    </td>
                    <td className={s.right}>
                      <Button size="sm" onClick={() => setConfirming(tok.id)}>
                        {t("tokens.revoke")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <ConfirmDialog
        open={!!revoking}
        title={t("tokens.revokeTitle", { name: revoking?.name ?? "" })}
        text={t("tokens.revokeText")}
        confirm={t("tokens.revoke")}
        onClose={() => setConfirming(null)}
        onConfirm={() => revoking && revoke(revoking.id)}
      />

      <Dialog
        open={!!fresh}
        onClose={() => setFresh(null)}
        title={t("tokens.newTitle", { name: fresh?.name ?? "" })}
        width={600}
      >
        {fresh && (
          <>
            <p className={own.text}>{t("tokens.once")}</p>
            <div className={own.secret}>
              <code className={own.token}>{fresh.token}</code>
              <Button
                size="sm"
                variant="ghost"
                icon="copy"
                aria-live="polite"
                onClick={() => copy("token", fresh.token)}
              >
                {copyLabel("token", t("common.copy"))}
              </Button>
            </div>
            <div className={own.card}>
              <CardHead icon="bot" title={t("tokens.promptTitle")} text={t("tokens.freshText")}>
                <Button
                  size="sm"
                  icon="copy"
                  aria-live="polite"
                  onClick={() =>
                    copy("fresh", t("tokens.promptToken", { url, token: fresh.token }))
                  }
                >
                  {copyLabel("fresh", t("tokens.copyPrompt"))}
                </Button>
              </CardHead>
            </div>
            <div className={own.actions}>
              <Button variant="primary" onClick={() => setFresh(null)}>
                {t("common.done")}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}

function CardHead(p: { icon: IconName; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className={own.row}>
      <span className={own.tile}>
        <Icon name={p.icon} size={20} />
      </span>
      <span className={own.what}>
        <span className={own.title}>{p.title}</span>
        {p.text && <span className={own.desc}>{p.text}</span>}
      </span>
      {p.children && <span className={own.acts}>{p.children}</span>}
    </div>
  );
}
