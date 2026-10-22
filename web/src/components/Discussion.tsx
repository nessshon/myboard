import { useId, useState, type KeyboardEvent } from "react";
import { add, drop, patch, personName, useMe, type Comment, type Setter, type User } from "../api";
import { formatMoment } from "../format";
import { useLang, useT } from "../i18n";
import { LIMITS } from "../limits";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Counter } from "./Counter";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { Menu, MenuItem } from "./Menu";
import { ConfirmDialog } from "./ProjectDialogs";
import { toast } from "./Toast";
import s from "./Discussion.module.css";

type Props = {
  taskId: string;
  people: User[];
  comments: Comment[];
  setComments: Setter<Comment>;
};

export function Discussion({ taskId, people, comments, setComments }: Props) {
  const t = useT();
  const lang = useLang();
  const me = useMe();
  const headId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Comment | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<Comment | null>(null);
  const failed = () => toast(t("common.saveFailed"));
  const actionFailed = () => toast(t("common.actionFailed"));
  const thread = comments
    .filter((c) => c.task === taskId)
    .sort((a, b) => a.created.localeCompare(b.created));

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const made = await add("comments", setComments, { task: taskId, body }, actionFailed);
    setBusy(false);
    if (made) setText("");
  }

  function save() {
    const body = draft.trim();
    if (!editing || !body) return;
    if (body !== editing.body) patch("comments", setComments, editing, { body }, failed);
    setEditing(null);
  }

  // Esc cancels an edit; in a filled reply field it only keeps the window from closing with the text.
  const keys = (onEnter: () => void, onEscape?: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onEnter();
    if (e.key === "Escape" && (onEscape || text.trim())) {
      e.preventDefault();
      onEscape?.();
    }
  };

  return (
    <section className={s.thread} aria-labelledby={headId}>
      <h4 id={headId} className="heading">
        {t("comment.title")}
        <span className="count">{thread.length}</span>
      </h4>
      {thread.map((c) => {
        const author = people.find((p) => p.id === c.author);
        const name = author ? personName(author, t("users.gone")) : "—";
        const mine = !!me && c.author === me.id;
        return (
          <article key={c.id} className={s.item}>
            <Avatar name={name} src={author?.avatar_url} size={28} />
            <div className={s.meta}>
              <span className={`ellipsis ${s.name}`}>{name}</span>
              <span className={s.time}>
                {formatMoment(c.created, lang)}
                {c.updated !== c.created && ` · ${t("comment.edited")}`}
              </span>
            </div>
            {(mine || me?.role === "admin") && editing?.id !== c.id && (
              <Menu
                label={t("comment.actions")}
                triggerClass={s.more}
                trigger={<Icon name="more" size={16} />}
              >
                {mine && (
                  <MenuItem
                    icon="pencil"
                    onClick={() => {
                      setDraft(c.body);
                      setEditing(c);
                    }}
                  >
                    {t("common.edit")}
                  </MenuItem>
                )}
                <MenuItem icon="trash" danger onClick={() => setDeleting(c)}>
                  {t("common.delete")}
                </MenuItem>
              </Menu>
            )}
            {editing?.id === c.id ? (
              <div className={s.edit}>
                <div className={s.box}>
                  <textarea
                    className={`input ${s.input}`}
                    aria-label={t("comment.placeholder")}
                    value={draft}
                    maxLength={LIMITS.comment}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={keys(save, () => setEditing(null))}
                  />
                  <Counter value={draft} max={LIMITS.comment} />
                </div>
                <div className={s.row}>
                  <Button size="sm" onClick={() => setEditing(null)}>
                    {t("common.cancel")}
                  </Button>
                  <Button size="sm" variant="primary" disabled={!draft.trim()} onClick={save}>
                    {t("common.save")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className={s.body}>
                <Markdown text={c.body} />
              </div>
            )}
          </article>
        );
      })}
      <div className={s.compose}>
        <div className={s.box}>
          <textarea
            className={`input ${s.input}`}
            aria-label={t("comment.placeholder")}
            placeholder={t("comment.placeholder")}
            value={text}
            maxLength={LIMITS.comment}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={keys(send)}
          />
          <Counter value={text} max={LIMITS.comment} />
        </div>
        <div className={s.row}>
          <span className={s.hint}>{t("comment.hint")}</span>
          <Button variant="primary" size="sm" disabled={!text.trim() || busy} onClick={send}>
            {t("comment.send")}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={!!deleting}
        title={t("comment.deleteTitle")}
        text={t("common.cannotUndo")}
        confirm={t("common.delete")}
        onConfirm={() => {
          drop("comments", setComments, deleting ?? undefined, actionFailed);
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}
