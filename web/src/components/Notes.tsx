import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { indexAmong, personName, type Note, type Project, type User } from "../api";
import { formatDate } from "../format";
import { useLang, useT } from "../i18n";
import { LIMITS } from "../limits";
import { Avatar } from "./Avatar";
import { useDragSensors } from "./Board";
import { Button } from "./Button";
import { Counter } from "./Counter";
import { Dialog } from "./Dialog";
import { Editor } from "./Editor";
import { Filter, FilterReset } from "./Filter";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { Menu, MenuItem } from "./Menu";
import { ProjectBadge } from "./ProjectBadge";
import { ConfirmDialog } from "./ProjectDialogs";
import { useLeaving, WindowTools } from "./TaskDialog";
import b from "./Button.module.css";
import w from "./TaskDialog.module.css";
import s from "./Notes.module.css";

type Draft = { title: string; body: string };

type Props = {
  me: User;
  notes: Note[] | null;
  people: User[];
  isPhone: boolean;
  projects?: Project[];
  onMove?: (id: string, index: number) => void;
  onCreate?: (draft: Draft) => Promise<Note | undefined>;
  onPatch: (id: string, patch: Partial<Pick<Note, "title" | "body" | "shared">>) => void;
  onDelete: (id: string) => void;
};

// Card text is plain: links keep their words, Markdown punctuation goes. Underscores are dropped
// only at word edges (_emphasis_), so identifiers like id_token survive.
const excerpt = (body: string) =>
  body
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-+]\s(\[[ x]\]\s)?/gm, "")
    .replace(/[#>*`~|]/g, "")
    .replace(/(^|[^\p{L}\p{N}_])_+|_+(?=[^\p{L}\p{N}_]|$)/gu, "$1");

export function Notes({
  me,
  notes,
  people,
  isPhone,
  projects,
  onMove,
  onCreate,
  onPatch,
  onDelete,
}: Props) {
  const t = useT();
  const headId = useId();
  const sensors = useDragSensors();
  const [open, setOpen] = useState<string | null>(null);
  // The window's own ways out (a click beside it, Esc) ask about unsaved text as its close button does.
  const closing = useRef(() => setOpen(null));
  // The server's view rule, repeated: an admin who makes someone's note personal keeps the
  // record locally (the update answers with it), but may no longer see it.
  const list = notes?.filter((n) => n.shared || n.author === me.id) ?? null;
  const note = list?.find((n) => n.id === open);
  const [picked, setAuthors] = useState<string[]>([]);
  const authors = picked.filter((id) => list?.some((n) => n.author === id) ?? true);
  const shown = list && (authors.length ? list.filter((n) => authors.includes(n.author)) : list);
  const writers = people.filter((p) => list?.some((n) => n.author === p.id));
  const authorOptions = [
    ...writers.filter((p) => p.id === me.id),
    ...writers.filter((p) => p.id !== me.id),
  ].map((p) => ({
    id: p.id,
    name: personName(p, t("users.gone")),
    icon: <Avatar name={personName(p)} src={p.avatar_url} size={18} />,
    count: list!.filter((n) => n.author === p.id).length,
  }));

  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () =>
      setEdges({
        left: el.scrollLeft > 2,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
      });
    measure();
    const size = new ResizeObserver(measure);
    size.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      size.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [shown?.length]);
  const page = (dir: number) =>
    track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.8 });

  function end({ active, over }: DragEndEvent) {
    if (!notes || !shown || !over) return;
    const ids = shown.map((n) => n.id);
    const index = ids.indexOf(over.id as string);
    if (index < 0 || index === ids.indexOf(active.id as string)) return;
    const others = (rows: Note[]) => rows.filter((n) => n.id !== active.id);
    onMove?.(String(active.id), indexAmong(others(notes), others(shown), index));
  }

  return (
    <section className={s.sec} aria-labelledby={headId}>
      <div className={s.head}>
        <h2 id={headId} className="heading">
          {t("project.notes")}
          {list && <span className="count">{list.length}</span>}
        </h2>
        {onCreate && (
          <Button size="sm" icon="plus" compact onClick={() => setOpen("new")}>
            {t("note.new")}
          </Button>
        )}
      </div>
      {!projects && !!list?.length && (
        <div className={s.filters}>
          <Filter
            title={t("task.author")}
            chosen={authors}
            onChange={setAuthors}
            options={authorOptions}
          />
          {authors.length > 0 && <FilterReset onClick={() => setAuthors([])} />}
        </div>
      )}
      {shown && shown.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
          <SortableContext
            items={shown.map((n) => n.id)}
            strategy={horizontalListSortingStrategy}
            disabled={!onMove}
          >
            <div className={s.strip}>
              {edges.left && (
                <button
                  type="button"
                  className={`${s.arrow} ${s.left}`}
                  aria-label={t("note.scrollLeft")}
                  onClick={() => page(-1)}
                >
                  <Icon name="chevronLeft" size={16} />
                </button>
              )}
              <div ref={track} className={s.track}>
                {shown.map((n) => (
                  <NoteCard
                    key={n.id}
                    note={n}
                    author={people.find((p) => p.id === n.author)}
                    project={projects?.find((p) => p.id === n.project)}
                    drag={!!onMove}
                    handle={isPhone}
                    onOpen={() => setOpen(n.id)}
                  />
                ))}
              </div>
              {edges.right && (
                <button
                  type="button"
                  className={`${s.arrow} ${s.right}`}
                  aria-label={t("note.scrollRight")}
                  onClick={() => page(1)}
                >
                  <Icon name="chevronRight" size={16} />
                </button>
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {list?.length === 0 && (
        <div className="empty">{t(projects ? "home.noNotes" : "note.empty")}</div>
      )}
      <Dialog
        open={open === "new" || !!note}
        onClose={() => closing.current()}
        title={<span className="caps">{note ? t("note.head") : t("note.newHead")}</span>}
        width={760}
        className={w.window}
      >
        <NoteBody
          key={note?.id ?? "new"}
          me={me}
          note={note}
          people={people}
          closing={closing}
          onClose={() => setOpen(null)}
          onShare={(shared) => note && onPatch(note.id, { shared })}
          onSave={async (draft) => {
            if (note) return onPatch(note.id, draft);
            const created = await onCreate?.(draft);
            if (created) setOpen(created.id);
          }}
          onDelete={() => {
            setOpen(null);
            if (note) onDelete(note.id);
          }}
        />
      </Dialog>
    </section>
  );
}

function NoteCard({
  note,
  author,
  project,
  drag,
  handle,
  onOpen,
}: {
  note: Note;
  author?: User;
  project?: Project;
  drag: boolean;
  handle: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note.id });
  const whole = drag && !handle;
  return (
    <div
      ref={setNodeRef}
      className={[s.note, whole && s.grab, isDragging && s.ghost].filter(Boolean).join(" ")}
      style={{ transform: CSS.Translate.toString(transform && { ...transform, y: 0 }), transition }}
      {...(whole ? listeners : {})}
    >
      <div className={s.top}>
        {project && (
          <ProjectBadge
            name={project.name}
            projectKey={project.key}
            color={project.color}
            size={18}
          />
        )}
        <button
          type="button"
          className={`stretch ${s.open}`}
          onClick={onOpen}
          {...(whole
            ? { ref: setActivatorNodeRef, "aria-describedby": attributes["aria-describedby"] }
            : {})}
        >
          {note.title}
        </button>
        {drag && handle && (
          <button
            ref={setActivatorNodeRef}
            type="button"
            className={`handle ${s.handle}`}
            {...attributes}
            {...listeners}
            aria-label={t("note.dragHandle")}
            title={t("note.dragHandle")}
          >
            <Icon name="grip" size={18} />
          </button>
        )}
      </div>
      <span className={`clamp ${s.two}`}>{excerpt(note.body)}</span>
      <div className={s.foot}>
        <span className={s.access}>
          <Icon name={note.shared ? "users" : "lock"} size={13} />
          {t(note.shared ? "note.shared" : "note.personal")}
        </span>
        {note.shared && author && (
          <span className={s.who} title={personName(author, t("users.gone"))}>
            <Avatar name={personName(author)} src={author.avatar_url} size={20} />
          </span>
        )}
        <span className={s.date}>{formatDate(note.edited || note.created, lang)}</span>
      </div>
    </div>
  );
}

function NoteBody({
  me,
  note,
  people,
  closing,
  onClose,
  onShare,
  onSave,
  onDelete,
}: {
  me: User;
  note?: Note;
  people: User[];
  closing: RefObject<() => void>;
  onClose: () => void;
  onShare: (shared: boolean) => void;
  onSave: (draft: Draft) => Promise<void> | void;
  onDelete: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const [editing, setEditing] = useState(!note);
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [tried, setTried] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const main = useRef<HTMLDivElement>(null);
  const titleField = useRef<HTMLTextAreaElement>(null);

  function edit() {
    if (!note) return;
    setTitle(note.title);
    setBody(note.body);
    setTried(false);
    setEditing(true);
  }

  async function save() {
    setTried(true);
    if (!title.trim() || busy) return;
    if (note) setEditing(false);
    else setBusy(true);
    await onSave({ title: title.trim(), body });
    setBusy(false);
  }

  function cancel() {
    setTried(false);
    setEditing(false);
  }

  const changed =
    editing &&
    (note ? title !== note.title || body !== note.body : !!title.trim() || !!body.trim());
  const { close, ask, question } = useLeaving(
    main,
    closing,
    () => changed,
    () => {},
    onClose,
  );

  // Into the title on the way in, back to the menu on the way out, as in a task.
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (editing) titleField.current?.focus({ preventScroll: true });
    else if (wasEditing.current)
      main.current
        ?.closest("dialog")
        ?.querySelector<HTMLElement>(`[aria-label="${t("note.actions")}"]`)
        ?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);

  // The same split as the server's rules for notes (internal/migrations/1760572800_init.go).
  const mine = note?.author === me.id;
  const admin = me.role === "admin";
  const author = note?.shared ? people.find((p) => p.id === note.author) : undefined;
  const dated =
    note &&
    `${t(note.edited ? "note.edited" : "note.created")} ${formatDate(note.edited || note.created, lang, "long")}`;

  return (
    <>
      <WindowTools onClose={close}>
        {note && !editing && !note.shared && mine && (
          <Button variant="ghost" icon="users" compact onClick={() => onShare(true)}>
            {t("note.share")}
          </Button>
        )}
        {note && !editing && note.shared && (mine || admin) && (
          <Button variant="ghost" icon="lock" compact onClick={() => onShare(false)}>
            {t("note.unshare")}
          </Button>
        )}
        {note && !editing && (
          <Menu
            label={t("note.actions")}
            triggerClass={b.icon}
            trigger={<Icon name="more" size={18} />}
          >
            <MenuItem icon="pencil" onClick={edit}>
              {t("common.edit")}
            </MenuItem>
            {(mine || (admin && note.shared)) && (
              <MenuItem icon="trash" danger onClick={() => setAsking(true)}>
                {t("common.delete")}
              </MenuItem>
            )}
          </Menu>
        )}
      </WindowTools>
      <div ref={main} className={w.main}>
        {editing ? (
          <Editor
            className={w.editor}
            head={
              <>
                <textarea
                  ref={titleField}
                  className={w.title}
                  rows={1}
                  aria-label={t("task.title")}
                  aria-invalid={tried && !title.trim()}
                  placeholder={t("note.titlePlaceholder")}
                  value={title}
                  maxLength={LIMITS.noteTitle}
                  onChange={(e) => setTitle(e.target.value)}
                  // A title is one line: Enter does not break it.
                  onKeyDown={(e) =>
                    e.key === "Enter" && !e.metaKey && !e.ctrlKey && e.preventDefault()
                  }
                />
                {tried && !title.trim() ? (
                  <span className="counter full">{t("task.titleRequired")}</span>
                ) : (
                  <Counter value={title} max={LIMITS.noteTitle} />
                )}
              </>
            }
            counter={<Counter value={body} max={LIMITS.noteBody} />}
            actions={
              note ? (
                <>
                  <Button size="sm" variant="ghost" onClick={cancel}>
                    {t("common.cancel")}
                  </Button>
                  <Button size="sm" variant="primary" onClick={save}>
                    {t("common.save")}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="primary" disabled={busy} onClick={save}>
                  {t("common.create")}
                </Button>
              )
            }
            onSubmit={save}
            onCancel={note ? () => (changed ? ask(cancel) : cancel()) : undefined}
          >
            <textarea
              aria-label={t("note.body")}
              placeholder={t("note.bodyPlaceholder")}
              value={body}
              maxLength={LIMITS.noteBody}
              onChange={(e) => setBody(e.target.value)}
            />
          </Editor>
        ) : (
          note && (
            <>
              <h3 className={w.title}>{note.title}</h3>
              <span className="hint">
                {dated}
                {author && ` · ${personName(author, t("users.gone"))}`}
              </span>
              {note.body ? (
                <div className={w.desc}>
                  <Markdown text={note.body} />
                </div>
              ) : (
                <button type="button" className={w.addDesc} onClick={edit}>
                  {t("note.noBody")}
                </button>
              )}
            </>
          )
        )}
      </div>
      {question}
      {note && (
        <ConfirmDialog
          open={asking}
          title={t("note.deleteTitle", { name: note.title })}
          text={t("common.cannotUndo")}
          confirm={t("common.delete")}
          onClose={() => setAsking(false)}
          onConfirm={onDelete}
        />
      )}
    </>
  );
}
