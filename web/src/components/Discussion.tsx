import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  add,
  drop,
  patch,
  personName,
  useMe,
  useReactions,
  type Comment,
  type ReactionKey,
  type Setter,
  type User,
} from "../api";
import { formatMoment } from "../format";
import { useLang, useT } from "../i18n";
import { LIMITS } from "../limits";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Counter } from "./Counter";
import { Icon } from "./Icon";
import { Markdown, mentionOf, mentions } from "./Markdown";
import { Menu, MenuItem } from "./Menu";
import menu from "./Menu.module.css";
import { ConfirmDialog } from "./ProjectDialogs";
import { Reactions } from "./Reactions";
import { toast } from "./Toast";
import s from "./Discussion.module.css";

type Props = {
  taskId: string;
  people: User[];
  members: User[];
  comments: Comment[];
  setComments: Setter<Comment>;
};

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The name in the field is the way back to the id, so namesakes get told apart.
function handleOf(person: User, people: User[]) {
  const name = personName(person);
  const twin = people.some((p) => p.id !== person.id && personName(p) === name);
  return twin ? `${name} (${person.username || person.id.slice(0, 5)})` : name;
}

// The field shows "@Name", the comment keeps the id (Markdown.tsx), so a rename does not break old
// mentions. Only names picked from the list count; one pass, longest names first.
function toStored(text: string, picks: Map<string, string>) {
  if (!picks.size) return text;
  const names = [...picks.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])@(${names.join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  return text.replace(
    re,
    (_, before: string, name: string) => before + mentionOf(name, picks.get(name)!),
  );
}

function toShown(body: string, people: User[]) {
  const picks = new Map<string, string>();
  const text = body.replace(mentions, (link: string, fallback: string, id: string) => {
    const person = people.find((p) => p.id === id);
    const name = person ? handleOf(person, people) : fallback;
    if (!name) return link;
    picks.set(name, id);
    return `@${name}`;
  });
  return { text, picks };
}

type FieldProps = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  mentionable: User[];
  handle: (person: User) => string;
  picks: Map<string, string>;
  placeholder?: string;
  autoFocus?: boolean;
};

function Field({
  value,
  onChange,
  onKeyDown,
  mentionable,
  handle,
  picks,
  placeholder,
  autoFocus,
}: FieldProps) {
  const t = useT();
  const listId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ at: number; text: string } | null>(null);
  const [active, setActive] = useState(0);
  const caret = useRef<number | null>(null);
  // The text can change from outside (sent, cancelled), so the list is open only while the typed "@…" is there.
  const typed =
    query && value.startsWith(`@${query.text}`, query.at) ? query.text.toLowerCase() : undefined;
  // A word of the name starts with what was typed.
  const matches =
    typed === undefined
      ? []
      : mentionable.filter((p) => ` ${handle(p).toLowerCase()}`.includes(` ${typed}`)).slice(0, 6);

  // The same "@" boundary as in toStored.
  function track(el: HTMLTextAreaElement) {
    const before = el.value.slice(0, el.selectionStart);
    const m = /(^|[^\p{L}\p{N}_])@([^\s@]*)$/u.exec(before);
    setQuery(m ? { at: before.length - m[2].length - 1, text: m[2] } : null);
    setActive(0);
  }

  // The caret goes after the inserted name as soon as the new text is in the field, before the next key.
  useLayoutEffect(() => {
    if (caret.current === null) return;
    ref.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  function pick(person: User) {
    if (!query) return;
    const name = handle(person);
    caret.current = query.at + name.length + 2;
    picks.set(name, person.id);
    onChange(
      `${value.slice(0, query.at)}@${name} ${value.slice(query.at + 1 + query.text.length)}`,
    );
    setQuery(null);
  }

  // While the list is open the arrows, Enter, Tab and Esc belong to it; Shift+Enter is still a new
  // line, and keys that compose a character (IME) are left alone.
  function keyDown(e: KeyboardEvent) {
    if (matches.length && !e.nativeEvent.isComposing) {
      const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? matches.length - 1 : 0;
      const accept =
        e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey);
      if (step || accept || e.key === "Escape") {
        e.preventDefault();
        if (step) setActive((active + step) % matches.length);
        else if (accept) pick(matches[active]);
        else setQuery(null);
        return;
      }
    }
    onKeyDown(e);
  }

  return (
    <>
      <textarea
        ref={ref}
        className={`input ${s.input}`}
        aria-label={t("comment.placeholder")}
        aria-autocomplete="list"
        aria-controls={matches.length ? listId : undefined}
        aria-activedescendant={matches.length ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        value={value}
        maxLength={LIMITS.comment}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          track(e.currentTarget);
        }}
        onSelect={(e) => track(e.currentTarget)}
        onBlur={() => setQuery(null)}
        onKeyDown={keyDown}
      />
      {matches.length > 0 && (
        <ul id={listId} role="listbox" aria-label={t("comment.mention")} className={s.people}>
          {matches.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`${menu.item} ${s.person}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
            >
              <Avatar name={personName(p)} src={p.avatar_url} size={20} />
              <span className="ellipsis">{handle(p)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function Discussion({ taskId, people, members, comments, setComments }: Props) {
  const t = useT();
  const lang = useLang();
  const me = useMe();
  const headId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Comment | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<Comment | null>(null);
  // Who was picked from the list in each field, by the name shown there.
  const sendPicks = useRef(new Map<string, string>());
  const editPicks = useRef(new Map<string, string>());
  // Whoever sees the task can be called in: project members and admins, as in the comments rule.
  const mentionable = people.filter(
    (p) =>
      !p.deleted && p.id !== me?.id && (p.role === "admin" || members.some((m) => m.id === p.id)),
  );
  const handle = (person: User) => handleOf(person, people);
  const failed = () => toast(t("common.saveFailed"));
  const actionFailed = () => toast(t("common.actionFailed"));
  const [reactions, setReactions] = useReactions(taskId, () => toast(t("common.loadFailed")));
  // A second tap before the server answers would add the same reaction twice and be refused.
  const reacting = useRef(new Set<string>());
  const thread = comments
    .filter((c) => c.task === taskId)
    .sort((a, b) => a.created.localeCompare(b.created));

  async function send() {
    const body = toStored(text.trim(), sendPicks.current);
    if (!body || busy) return;
    setBusy(true);
    const made = await add("comments", setComments, { task: taskId, body }, actionFailed);
    setBusy(false);
    if (made) {
      setText("");
      sendPicks.current.clear();
    }
  }

  async function react(comment: string, emoji: ReactionKey) {
    const key = `${comment} ${emoji}`;
    if (!me || reacting.current.has(key)) return;
    reacting.current.add(key);
    const mine = reactions?.find(
      (r) => r.comment === comment && r.emoji === emoji && r.author === me.id,
    );
    await (mine
      ? drop("reactions", setReactions, mine, actionFailed)
      : add("reactions", setReactions, { comment, emoji }, actionFailed));
    reacting.current.delete(key);
  }

  function save() {
    const body = toStored(draft.trim(), editPicks.current);
    if (!editing || !body) return;
    // Compared as shown: a renamed person changes the stored link text, not what was written.
    if (draft.trim() !== toShown(editing.body, people).text) {
      patch("comments", setComments, editing, { body }, failed);
    }
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
                      const shown = toShown(c.body, people);
                      editPicks.current = shown.picks;
                      setDraft(shown.text);
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
                  <Field
                    value={draft}
                    onChange={setDraft}
                    onKeyDown={keys(save, () => setEditing(null))}
                    mentionable={mentionable}
                    handle={handle}
                    picks={editPicks.current}
                    autoFocus
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
                <Markdown text={c.body} people={people} />
              </div>
            )}
            {reactions && me && editing?.id !== c.id && (
              <Reactions
                reactions={reactions.filter((r) => r.comment === c.id)}
                people={people}
                me={me.id}
                onToggle={(emoji) => react(c.id, emoji)}
              />
            )}
          </article>
        );
      })}
      <div className={s.compose}>
        <div className={s.box}>
          <Field
            value={text}
            onChange={setText}
            onKeyDown={keys(send)}
            mentionable={mentionable}
            handle={handle}
            picks={sendPicks.current}
            placeholder={t("comment.placeholder")}
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
