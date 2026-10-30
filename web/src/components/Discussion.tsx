import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  add,
  drop,
  patch,
  personName,
  useMe,
  useReactions,
  type Attachment,
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
import { Editor } from "./Editor";
import {
  Files,
  forget,
  pick,
  unpick,
  useAttach,
  useFileEdit,
  type Upload,
  type useUploads,
} from "./Files";
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
  attachments: Attachment[];
  setAttachments: Setter<Attachment>;
  uploads: ReturnType<typeof useUploads>;
  token: string;
  // What is typed here and not sent or saved, for the window to ask about before it closes.
  pending: RefObject<{ unsaved: boolean; discard: () => void }>;
  ask: (then: () => void) => void;
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
  mentionable: User[];
  handle: (person: User) => string;
  picks: Map<string, string>;
  placeholder?: string;
  autoFocus?: boolean;
};

function Field({
  value,
  onChange,
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
  // line, and keys that compose a character (IME) are left alone. Other keys go on to the editor.
  function keyDown(e: KeyboardEvent) {
    if (!matches.length || e.nativeEvent.isComposing) return;
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? matches.length - 1 : 0;
    const accept =
      e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey);
    if (!step && !accept && e.key !== "Escape") return;
    e.preventDefault();
    if (step) setActive((active + step) % matches.length);
    else if (accept) pick(matches[active]);
    else setQuery(null);
  }

  return (
    <>
      <textarea
        ref={ref}
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

export function Discussion({
  taskId,
  people,
  members,
  comments,
  setComments,
  attachments,
  setAttachments,
  uploads,
  token,
  pending,
  ask,
}: Props) {
  const t = useT();
  const lang = useLang();
  const me = useMe();
  const headId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Comment | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<Comment | null>(null);
  const [picked, setPicked] = useState<Upload[]>([]);
  const attach = useAttach(take);
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
  const fileEdit = useFileEdit(setAttachments, actionFailed);
  const editAttach = useAttach(addToEdited);
  const [reactions, setReactions] = useReactions(taskId, () => toast(t("common.loadFailed")));
  // A second tap before the server answers would add the same reaction twice and be refused.
  const reacting = useRef(new Set<string>());
  const thread = comments
    .filter((c) => c.task === taskId)
    .sort((a, b) => a.created.localeCompare(b.created));

  const going = picked.filter((u) => u.state === "picked");
  const filesOf = (comment: string) => attachments.filter((a) => a.comment === comment);
  const uploadsOf = (comment: string) => uploads.uploads.filter((u) => u.comment === comment);
  const sending = (comment: string) => uploadsOf(comment).some((u) => u.state === "sending");

  function take(files: File[]) {
    let room = LIMITS.attachmentsPerComment - going.length;
    const fresh = pick(files, taskId, t).map((u) => {
      if (u.state !== "picked" || room-- > 0) return u;
      forget(u);
      const reason = t("file.tooMany", { count: LIMITS.attachmentsPerComment });
      return { ...u, state: "refused" as const, reason, preview: undefined };
    });
    setPicked((p) => [...p, ...fresh]);
  }

  // The comment goes first and its files after it, so a file never hangs without its comment.
  async function send() {
    const body = toStored(text.trim(), sendPicks.current);
    if ((!body && !going.length) || busy) return;
    setBusy(true);
    const made = await add("comments", setComments, { task: taskId, body }, actionFailed);
    setBusy(false);
    if (!made) return;
    setText("");
    sendPicks.current.clear();
    picked.filter((u) => u.state === "refused").forEach(forget);
    setPicked([]);
    if (!going.length) return;
    const sent = await uploads.send(going, made.id);
    if (!body && !sent.length) {
      // A comment of files alone that got none of them says nothing: take it back, give the files back.
      drop("comments", setComments, made, actionFailed);
      uploads.dropAll(going.map((u) => u.key));
      setPicked(
        pick(
          going.map((u) => u.file),
          taskId,
          t,
        ),
      );
      toast(t("file.commentFailed"));
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

  function startEdit(c: Comment) {
    const shown = toShown(c.body, people);
    editPicks.current = shown.picks;
    setDraft(shown.text);
    fileEdit.begin();
    setEditing(c);
  }

  // A file added while editing goes at once, as under a task's description; still ten to a comment.
  function addToEdited(files: File[]) {
    if (!editing) return;
    let room =
      LIMITS.attachmentsPerComment -
      fileEdit.shown(filesOf(editing.id)).length -
      uploadsOf(editing.id).length;
    const fresh: Upload[] = [];
    for (const u of pick(files, taskId, t)) {
      if (u.reason) toast(`${u.file.name}: ${u.reason}`);
      else if (room-- > 0) fresh.push(u);
      else {
        forget(u);
        toast(`${u.file.name}: ${t("file.tooMany", { count: LIMITS.attachmentsPerComment })}`);
      }
    }
    fileEdit.track(uploads.send(fresh, editing.id));
  }

  function save() {
    if (!editing || sending(editing.id)) return;
    const body = toStored(draft.trim(), editPicks.current);
    const files = filesOf(editing.id);
    if (!body && !fileEdit.shown(files).length) return;
    // Compared as shown: a renamed person changes the stored link text, not what was written.
    if (draft.trim() !== toShown(editing.body, people).text) {
      patch("comments", setComments, editing, { body }, failed);
    }
    fileEdit.save();
    setEditing(null);
  }

  function cancel() {
    if (!editing) return;
    fileEdit.cancel();
    uploadsOf(editing.id).forEach((u) => uploads.dismiss(u.key));
    setEditing(null);
  }

  const changed =
    !!editing && (draft.trim() !== toShown(editing.body, people).text || fileEdit.changed);
  useEffect(() => {
    pending.current = { unsaved: changed || !!text.trim() || going.length > 0, discard: cancel };
  });

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
                  <MenuItem icon="pencil" onClick={() => startEdit(c)}>
                    {t("common.edit")}
                  </MenuItem>
                )}
                <MenuItem icon="trash" danger onClick={() => setDeleting(c)}>
                  {t("common.delete")}
                </MenuItem>
              </Menu>
            )}
            {editing?.id === c.id ? (
              <Editor
                className={s.body}
                attach={editAttach}
                files={
                  <Files
                    items={fileEdit.shown(filesOf(c.id))}
                    uploads={uploadsOf(c.id)}
                    token={token}
                    canRemove={() => true}
                    onRemove={fileEdit.hide}
                    onRetry={uploads.retry}
                    onDismiss={uploads.dismiss}
                  />
                }
                counter={<Counter value={draft} max={LIMITS.comment} />}
                actions={
                  <>
                    <Button size="sm" variant="ghost" onClick={cancel}>
                      {t("common.cancel")}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={
                        sending(c.id) || (!draft.trim() && !fileEdit.shown(filesOf(c.id)).length)
                      }
                      onClick={save}
                    >
                      {t("common.save")}
                    </Button>
                  </>
                }
                onSubmit={save}
                onCancel={() => (changed ? ask(cancel) : cancel())}
              >
                <Field
                  value={draft}
                  onChange={setDraft}
                  mentionable={mentionable}
                  handle={handle}
                  picks={editPicks.current}
                  autoFocus
                />
              </Editor>
            ) : (
              <>
                {c.body && (
                  <div className={s.body}>
                    <Markdown text={c.body} people={people} />
                  </div>
                )}
                {(filesOf(c.id).length > 0 || uploadsOf(c.id).length > 0) && (
                  <div className={s.body}>
                    <Files
                      items={filesOf(c.id)}
                      uploads={uploadsOf(c.id)}
                      token={token}
                      onRetry={uploads.retry}
                      onDismiss={uploads.dismiss}
                    />
                  </div>
                )}
              </>
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
      <Editor
        attach={attach}
        files={
          <Files
            items={[]}
            uploads={picked}
            token={token}
            onDismiss={(key) => setPicked((p) => unpick(p, key))}
          />
        }
        counter={<Counter value={text} max={LIMITS.comment} />}
        actions={
          <Button
            variant="primary"
            size="sm"
            disabled={(!text.trim() && !going.length) || busy}
            onClick={send}
          >
            {t("comment.send")}
          </Button>
        }
        onSubmit={send}
      >
        <Field
          value={text}
          onChange={setText}
          mentionable={mentionable}
          handle={handle}
          picks={sendPicks.current}
          placeholder={t("comment.placeholder")}
        />
      </Editor>
      <ConfirmDialog
        open={!!deleting}
        title={t("comment.deleteTitle")}
        text={
          deleting && filesOf(deleting.id).length
            ? `${t("comment.deleteFiles", { count: filesOf(deleting.id).length })} ${t("common.cannotUndo")}`
            : t("common.cannotUndo")
        }
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
