import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  PRIORITIES,
  STATUSES,
  drop,
  isClosed,
  useAttachments,
  useFileToken,
  useMe,
  type Comment,
  type Label,
  type Setter,
  type Task,
  type User,
  personName,
} from "../api";
import { formatDate, formatDue, isOverdue } from "../format";
import { useLang, useT } from "../i18n";
import { LIMITS } from "../limits";
import { Avatar } from "./Avatar";
import { StatusDot } from "./Board";
import { Button } from "./Button";
import { Counter } from "./Counter";
import { Dialog } from "./Dialog";
import { Discussion } from "./Discussion";
import { Files, pick, useAttach, useUploads } from "./Files";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { Menu, MenuCheck } from "./Menu";
import { PROJECT_COLORS } from "./ProjectBadge";
import { ConfirmDialog } from "./ProjectDialogs";
import { Select } from "./Select";
import { toast } from "./Toast";
import s from "./TaskDialog.module.css";

export type TaskFields = Pick<
  Task,
  "title" | "description" | "status" | "priority" | "assignees" | "due" | "labels"
>;

const blank: TaskFields = {
  title: "",
  description: "",
  status: "todo",
  priority: "normal",
  assignees: [],
  due: "",
  labels: [],
};

type Props = {
  task?: Task;
  projectKey: string;
  labels: Label[];
  members: User[];
  people: User[];
  onClose: () => void;
  onPatch: (patch: Partial<TaskFields>) => void;
  onCreate?: (fields: TaskFields) => Promise<void> | void;
  onDelete: () => void;
  onCreateLabel: (name: string, color: string) => Promise<Label | undefined>;
  comments: Comment[] | null;
  setComments: Setter<Comment>;
};

export function TaskDialog({ open, ...props }: Props & { open: boolean }) {
  const t = useT();
  const { task, projectKey } = props;
  return (
    <Dialog
      open={open}
      onClose={props.onClose}
      width={920}
      className={`${s.window} ${s.dialog}`}
      title={
        task ? (
          <span className={s.key}>{`${projectKey}-${task.number}`}</span>
        ) : (
          <span className="caps">{t("task.newHead")}</span>
        )
      }
    >
      <TaskBody key={task?.id ?? "new"} {...props} />
    </Dialog>
  );
}

function TaskBody({
  task,
  projectKey,
  labels,
  members,
  people,
  onClose,
  onPatch,
  onCreate,
  onDelete,
  onCreateLabel,
  comments,
  setComments,
}: Props) {
  const t = useT();
  const lang = useLang();
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState(!task);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [tried, setTried] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const me = useMe();
  const [attachments, setAttachments] = useAttachments(task?.id, () =>
    toast(t("common.loadFailed")),
  );
  const token = useFileToken(!!task);
  const uploads = useUploads(setAttachments);
  const attach = useAttach(attachFiles);

  const v = task ?? draft;
  const set = (patch: Partial<TaskFields>) =>
    task ? onPatch(patch) : setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    setTried(true);
    if (!title.trim() || busy) return;
    if (!task) {
      setBusy(true);
      await onCreate?.({ ...draft, title: title.trim(), description });
      setBusy(false);
      return;
    }
    setEditing(false);
    onPatch({ title: title.trim(), description });
  }

  function cancel() {
    if (!task) return onClose();
    setTitle(task.title);
    setDescription(task.description);
    setTried(false);
    setEditing(false);
  }

  const choices = [
    ...members,
    ...people.filter((p) => v.assignees.includes(p.id) && !members.some((m) => m.id === p.id)),
  ];
  const who = v.assignees.flatMap((id) => people.filter((p) => p.id === id));
  const assign = (id: string) =>
    set({
      assignees: v.assignees.includes(id)
        ? v.assignees.filter((x) => x !== id)
        : [...v.assignees, id],
    });
  const author = task && people.find((p) => p.id === task.author);

  // A file under the description goes at once, as a comment does; it does not wait for "Save".
  function attachFiles(files: File[]) {
    if (!task || !files.length) return;
    const all = pick(files, task.id, t);
    all.filter((u) => u.reason).forEach((u) => toast(`${u.file.name}: ${u.reason}`));
    uploads.send(all.filter((u) => !u.reason));
  }
  const files = task && (
    <Files
      items={(attachments ?? []).filter((a) => !a.comment)}
      uploads={uploads.uploads.filter((u) => !u.comment)}
      token={token}
      canRemove={editing ? (a) => a.author === me?.id || me?.role === "admin" : undefined}
      onRemove={(a) =>
        drop("attachments", setAttachments, a, () => toast(t("common.actionFailed")))
      }
      onRetry={uploads.retry}
      onDismiss={uploads.dismiss}
    />
  );
  const day = (timestamp: string) => formatDate(timestamp, lang);
  const chosen = labels.filter((l) => v.labels.includes(l.id));
  const toggle = (id: string) =>
    set({ labels: v.labels.includes(id) ? v.labels.filter((x) => x !== id) : [...v.labels, id] });

  return (
    <>
      <WindowTools
        editing={editing}
        isNew={!task}
        busy={busy}
        deleteLabel={t("task.delete")}
        onEdit={() => setEditing(true)}
        onDelete={() => setAsking(true)}
        onCancel={cancel}
        onSave={save}
        onClose={onClose}
      />
      <div
        className={s.main}
        onKeyDown={(e) => {
          if (editing && e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
      >
        {editing ? (
          <>
            <div className={s.box}>
              <input
                className={`input inplace ${s.titleIn}`}
                aria-label={t("task.title")}
                aria-invalid={tried && !title.trim()}
                placeholder={t("task.titlePlaceholder")}
                value={title}
                maxLength={LIMITS.taskTitle}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
              />
              {tried && !title.trim() ? (
                <span className="counter full">{t("task.titleRequired")}</span>
              ) : (
                <Counter value={title} max={LIMITS.taskTitle} />
              )}
            </div>
            {/* A new task has nowhere to keep a file yet: files are attached once it is created. */}
            <div
              {...(task && attach.zone)}
              className={`${s.box} ${s.grow} ${task ? attach.zone.className : ""}`}
            >
              <textarea
                className={`input inplace ${s.descIn}`}
                aria-label={t("task.description")}
                placeholder={t("task.descriptionPlaceholder")}
                value={description}
                maxLength={LIMITS.taskDescription}
                onChange={(e) => setDescription(e.target.value)}
                onPaste={task && attach.onPaste}
              />
              <Counter value={description} max={LIMITS.taskDescription} />
              {task && attach.button}
            </div>
            {files}
          </>
        ) : (
          <>
            <h3 className={s.title}>{v.title}</h3>
            {v.description ? (
              <div className={s.desc}>
                <Markdown text={v.description} />
                {files}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className={`${s.descEmpty} inplace multi`}
                  onClick={() => setEditing(true)}
                >
                  {t("task.noDescription")}
                </button>
                {files}
              </>
            )}
          </>
        )}
      </div>
      <aside className={s.side}>
        <div className={s.props}>
          <label className={s.k} htmlFor="task-status">
            {t("task.status")}
          </label>
          <div className={s.pick}>
            <span className={s.ico}>
              <StatusDot status={v.status} />
            </span>
            <Select
              id="task-status"
              value={v.status}
              onChange={(e) => set({ status: e.target.value as Task["status"] })}
            >
              {STATUSES.map((x) => (
                <option key={x} value={x}>
                  {t(`status.${x}`)}
                </option>
              ))}
            </Select>
          </div>
          <label className={s.k} htmlFor="task-priority">
            {t("task.priority")}
          </label>
          <div className={s.pick}>
            <span className={s.ico}>
              <span className={`${s.bar} ${s[v.priority]}`} />
            </span>
            <Select
              id="task-priority"
              value={v.priority}
              onChange={(e) => set({ priority: e.target.value as Task["priority"] })}
            >
              {PRIORITIES.map((x) => (
                <option key={x} value={x}>
                  {t(`priority.${x}`)}
                </option>
              ))}
            </Select>
          </div>
          <span className={`${s.k} ${s.top}`}>{t("task.assignees")}</span>
          <Menu
            label={t("task.assignees")}
            triggerClass={s.lfield}
            trigger={
              <>
                <span className={s.ico}>
                  <Icon name="userCheck" size={16} />
                </span>
                {who.length === 0 ? (
                  <span className={s.none}>{t("task.unassigned")}</span>
                ) : (
                  <span className={s.people}>
                    <span className={s.faces}>
                      {who.slice(0, 3).map((p) => (
                        <Avatar key={p.id} name={personName(p)} src={p.avatar_url} size={18} />
                      ))}
                    </span>
                    <span className="ellipsis">
                      {who.map((p) => personName(p, t("users.gone"))).join(", ")}
                    </span>
                  </span>
                )}
              </>
            }
          >
            {choices.map((m) => (
              <MenuCheck
                key={m.id}
                checked={v.assignees.includes(m.id)}
                disabled={!v.assignees.includes(m.id) && v.assignees.length >= LIMITS.assignees}
                onClick={() => assign(m.id)}
                icon={<Avatar name={personName(m)} src={m.avatar_url} size={18} />}
              >
                {personName(m, t("users.gone"))}
              </MenuCheck>
            ))}
          </Menu>
          <label className={s.k} htmlFor="task-due">
            {t("task.due")}
          </label>
          <div className={`${s.pick} ${s.due}`}>
            <span className={s.ico}>
              <Icon name="calendar" size={16} />
            </span>
            <span
              className={[
                s.dueText,
                !v.due && s.unset,
                isOverdue(v.due) && !isClosed(v.status) && s.late,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {v.due ? formatDue(v.due, lang, "long") : t("task.noDue")}
            </span>
            <input
              id="task-due"
              type="date"
              className={s.dueIn}
              value={v.due}
              onChange={(e) => set({ due: e.target.value })}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker();
                } catch {
                  // Engines without showPicker() open the picker on their own.
                }
              }}
            />
            {v.due && (
              <button
                type="button"
                className={s.clear}
                aria-label={t("task.clearDue")}
                title={t("task.clearDue")}
                onClick={() => set({ due: "" })}
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
          <span className={`${s.k} ${s.top}`}>{t("task.labels")}</span>
          <LabelPicker
            labels={labels}
            chosen={chosen}
            onToggle={toggle}
            onCreate={async (name) => {
              const label = await onCreateLabel(
                name,
                PROJECT_COLORS[labels.length % PROJECT_COLORS.length],
              );
              if (label) set({ labels: [...v.labels, label.id] });
            }}
          />
        </div>
        {task && (
          <div className={s.made}>
            {author && (
              <span className={s.by}>
                {t("task.author")}
                <Avatar name={personName(author)} src={author.avatar_url} size={16} />
                <span className={s.who}>{personName(author, t("users.gone"))}</span>
              </span>
            )}
            <dl className={s.dates}>
              <dt>{t("task.created")}</dt>
              <dd>{day(task.created)}</dd>
              {task.started && (
                <>
                  <dt>{t("task.started")}</dt>
                  <dd>{day(task.started)}</dd>
                </>
              )}
              {task.closed && (
                <>
                  <dt>
                    {t(task.status === "done" ? "task.closed.done" : "task.closed.cancelled")}
                  </dt>
                  <dd>{day(task.closed)}</dd>
                </>
              )}
              {task.edited && (
                <>
                  <dt>{t("task.edited")}</dt>
                  <dd>{day(task.edited)}</dd>
                </>
              )}
            </dl>
          </div>
        )}
      </aside>
      {task && comments && (
        <div className={s.discussion}>
          <Discussion
            taskId={task.id}
            people={people}
            members={members}
            comments={comments}
            setComments={setComments}
            attachments={attachments ?? []}
            setAttachments={setAttachments}
            uploads={uploads}
            token={token}
          />
        </div>
      )}
      {task && (
        <ConfirmDialog
          open={asking}
          title={t("task.deleteTitle", { key: `${projectKey}-${task.number}` })}
          text={t("common.cannotUndo")}
          confirm={t("common.delete")}
          onClose={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            onDelete();
          }}
        />
      )}
    </>
  );
}

export function WindowTools({
  editing,
  isNew,
  busy,
  deleteLabel,
  onEdit,
  onDelete,
  onCancel,
  onSave,
  onClose,
  children,
}: {
  editing: boolean;
  isNew: boolean;
  busy: boolean;
  deleteLabel: string;
  onEdit: () => void;
  onDelete?: () => void;
  onCancel: () => void;
  onSave: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  const tools = useRef<HTMLDivElement>(null);

  // While an open item is being edited, Esc leaves editing instead of closing the window and
  // dropping the text. The label picker is a window of its own and takes its own Esc. No deps:
  // the listener has to call this render's onCancel, which resets to the latest saved text.
  useEffect(() => {
    const dialog = tools.current?.closest("dialog");
    if (isNew || !editing || !dialog) return;
    const cancel = (e: Event) => {
      e.preventDefault();
      onCancel();
    };
    dialog.addEventListener("cancel", cancel);
    return () => dialog.removeEventListener("cancel", cancel);
  });

  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing)
      tools.current?.querySelector<HTMLElement>(`.${s.pen}`)?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);

  return (
    <div ref={tools} className={s.tools}>
      {editing ? (
        <span key="edit" className={s.pair}>
          {!isNew && <Button onClick={onCancel}>{t("common.cancel")}</Button>}
          <Button variant="primary" disabled={busy} onClick={onSave}>
            {isNew ? t("common.create") : t("common.save")}
          </Button>
        </span>
      ) : (
        <Fragment key="view">
          {children}
          <Button icon="pencil" className={s.pen} aria-label={t("common.edit")} onClick={onEdit} />
          {onDelete && (
            <Button icon="trash" className={s.del} aria-label={deleteLabel} onClick={onDelete} />
          )}
        </Fragment>
      )}
      <span className={s.sep} aria-hidden="true" />
      <Button icon="x" aria-label={t("common.close")} onClick={onClose} />
    </div>
  );
}

function LabelPicker({
  labels,
  chosen,
  onToggle,
  onCreate,
}: {
  labels: Label[];
  chosen: Label[];
  onToggle: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim();
  const found = labels.filter((l) => l.name.toLowerCase().includes(q.toLowerCase()));
  const exists = labels.some((l) => l.name.toLowerCase() === q.toLowerCase());

  async function create() {
    if (!q || exists) return;
    await onCreate(q);
    setQuery("");
  }

  return (
    <>
      <button
        type="button"
        className={s.lfield}
        aria-label={t("task.labels")}
        aria-haspopup="dialog"
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
      >
        <span className={s.ico}>
          <Icon name="tag" size={16} />
        </span>
        {chosen.length === 0 && <span className={s.none}>{t("task.noLabels")}</span>}
        {chosen.map((l) => (
          <span key={l.id} className="tag">
            <span className="dot" style={{ background: l.color }} />
            <span className="ellipsis">{l.name}</span>
          </span>
        ))}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("task.labels")} width={400}>
        <input
          className={`input ${s.search}`}
          placeholder={t("task.labelPlaceholder")}
          aria-label={t("task.labelPlaceholder")}
          value={query}
          maxLength={LIMITS.labelName}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && found.length === 0) create();
          }}
        />
        <div className={s.options}>
          {found.map((l) => {
            const on = chosen.some((c) => c.id === l.id);
            return (
              <button
                key={l.id}
                type="button"
                className={s.opt}
                aria-pressed={on}
                onClick={() => onToggle(l.id)}
              >
                <span className="tick" aria-hidden="true">
                  <Icon name="check" size={12} strokeWidth={3} />
                </span>
                <span className={s.tdot} style={{ background: l.color }} />
                <span className={`ellipsis ${s.one}`}>{l.name}</span>
              </button>
            );
          })}
          {q && !exists && (
            <button type="button" className={`${s.opt} ${s.create}`} onClick={create}>
              <Icon name="plus" size={14} />
              <span className={`ellipsis ${s.one}`}>
                {t("task.createLabel")} «{q}»
              </span>
            </button>
          )}
          {!q && labels.length === 0 && <p className="hint">{t("task.noLabelsYet")}</p>}
        </div>
        <div className={s.pickerFoot}>
          <Button variant="primary" onClick={() => setOpen(false)}>
            {t("common.done")}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
