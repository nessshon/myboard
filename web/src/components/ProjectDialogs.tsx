import { ClientResponseError } from "pocketbase";
import { useState, type FormEvent } from "react";
import { create, membersOf, remove, update, type Project, type User, personName } from "../api";
import { useT, type Key } from "../i18n";
import { LIMITS } from "../limits";
import { navigate, projectPath } from "../router";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Counter } from "./Counter";
import { initial, PROJECT_COLORS, projectColor } from "./ProjectBadge";
import { Dialog } from "./Dialog";
import { Select } from "./Select";
import { toast } from "./Toast";
import s from "./ProjectDialogs.module.css";

const KEY = /^[A-Z][A-Z0-9]{1,9}$/;

const suggestKey = (name: string) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 3);

export function ConfirmDialog({
  open,
  title,
  text,
  confirm,
  variant = "danger",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  text?: string;
  confirm: string;
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {text && <p className={s.text}>{text}</p>}
      <div className={s.actions}>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant={variant} onClick={onConfirm}>
          {confirm}
        </Button>
      </div>
    </Dialog>
  );
}

export function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t("project.newTitle")}>
      <ProjectForm onClose={onClose} onSaved={onCreated} />
    </Dialog>
  );
}

export function EditProjectDialog({
  open,
  project,
  onClose,
}: {
  open: boolean;
  project: Project;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t("project.editTitle")}>
      <ProjectForm
        project={project}
        onClose={onClose}
        onSaved={(p) => {
          onClose();
          if (p.key !== project.key) navigate(projectPath(p.key), true);
        }}
      />
    </Dialog>
  );
}

function ProjectForm({
  project,
  onClose,
  onSaved,
}: {
  project?: Project;
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const t = useT();
  const [name, setName] = useState(project?.name ?? "");
  const [typedKey, setTypedKey] = useState(project?.key);
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color ?? "");
  const [taken, setTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const key = typedKey ?? suggestKey(name);
  const keyOk = KEY.test(key);
  const ok = name.trim() !== "" && keyOk && !taken;

  const keyError: Key | null = taken
    ? "project.keyTaken"
    : /[^A-Z0-9]/.test(key)
      ? "project.keyLatin"
      : /^[0-9]/.test(key)
        ? "project.keyLetter"
        : key.length === 1
          ? "project.keyShort"
          : null;
  const keyChanged = !!project && keyOk && key !== project.key;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!ok || busy) return;
    setBusy(true);
    const data = { name: name.trim(), key, description: description.trim(), color };
    try {
      onSaved(
        project
          ? await update<Project>("projects", project.id, data)
          : await create<Project>("projects", data),
      );
    } catch (err) {
      const code = err instanceof ClientResponseError ? err.response?.data?.key?.code : undefined;
      if (code === "validation_not_unique") setTaken(true);
      else toast(t("common.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={submit}>
      <label className={s.field}>
        <span className="caption">{t("project.name")}</span>
        <input
          className="input"
          value={name}
          maxLength={LIMITS.projectName}
          aria-invalid={tried && !name.trim()}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        {tried && !name.trim() ? (
          <span className="counter full">{t("project.nameRequired")}</span>
        ) : (
          <Counter value={name} max={LIMITS.projectName} />
        )}
      </label>
      <label className={s.field}>
        <span className="caption">{t("project.key")}</span>
        <input
          className={`input ${s.key}`}
          value={key}
          maxLength={10}
          aria-invalid={!!keyError}
          onChange={(e) => {
            setTypedKey(e.target.value.toUpperCase());
            setTaken(false);
          }}
        />
        {keyError && <span className={`hint ${s.bad}`}>{t(keyError)}</span>}
        {!keyError && keyChanged && <span className="hint">{t("project.keyChange", { key })}</span>}
      </label>
      <div className={s.field} role="group" aria-label={t("project.color")}>
        <span className="caption">{t("project.color")}</span>
        <div className={s.swatches}>
          {PROJECT_COLORS.map((c, i) => (
            <button
              key={c}
              type="button"
              aria-pressed={projectColor(key, color) === c}
              aria-label={`${t("project.color")} ${i + 1}`}
              className={s.swatch}
              style={{ background: c, color: c }}
              onClick={() => setColor(c)}
            >
              {initial(name)}
            </button>
          ))}
        </div>
      </div>
      <label className={s.field}>
        <span className="caption">
          {t("project.description")} <span className="hint">{t("common.optional")}</span>
        </span>
        <textarea
          className={`input ${s.desc}`}
          value={description}
          maxLength={LIMITS.projectDescription}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Counter value={description} max={LIMITS.projectDescription} />
      </label>
      <div className={s.actions}>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={(name.trim() !== "" && !ok) || busy}>
          {project ? t("common.save") : t("common.create")}
        </Button>
      </div>
    </form>
  );
}

export function MembersDialog({
  open,
  project,
  people,
  readOnly,
  onClose,
}: {
  open: boolean;
  project: Project;
  people: User[];
  readOnly?: boolean;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t("project.membersTitle")} width={480}>
      <Members project={project} people={people} readOnly={readOnly} />
      <div className={s.actions}>
        <Button onClick={onClose}>{t(readOnly ? "common.close" : "common.done")}</Button>
      </div>
    </Dialog>
  );
}

function Members({
  project,
  people,
  readOnly,
}: {
  project: Project;
  people: User[];
  readOnly?: boolean;
}) {
  const t = useT();
  const [pick, setPick] = useState("");
  const members = membersOf(project, people);
  const others = people.filter((p) => !p.deleted && !project.members.includes(p.id));

  const save = (members: string[]) =>
    update("projects", project.id, { members }).catch(() => toast(t("common.saveFailed")));

  return (
    <>
      {members.length > 0 && (
        <ul className={s.rows}>
          {members.map((m) => (
            <li key={m.id} className={s.row}>
              <Avatar name={personName(m)} src={m.avatar_url} size={28} />
              <span className={s.person}>
                <span className={s.name}>{personName(m)}</span>
                {m.username && <span className="hint">@{m.username}</span>}
              </span>
              {!readOnly && (
                <Button size="sm" onClick={() => save(project.members.filter((id) => id !== m.id))}>
                  {t("common.remove")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && others.length > 0 && (
        <div className={s.add}>
          <Select
            className={s.grow}
            aria-label={t("project.addMember")}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">{t("project.addMember")}</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </Select>
          <Button
            disabled={!pick}
            onClick={() => {
              save([...project.members, pick]);
              setPick("");
            }}
          >
            {t("common.add")}
          </Button>
        </div>
      )}
    </>
  );
}

export function ArchiveDialog({
  open,
  project,
  onClose,
}: {
  open: boolean;
  project: Project;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <ConfirmDialog
      open={open}
      title={t("project.archiveTitle", { name: project.name })}
      text={t("project.archiveText")}
      confirm={t("project.archive")}
      variant="primary"
      onClose={onClose}
      onConfirm={() => {
        onClose();
        update("projects", project.id, { archived: true }).catch(() =>
          toast(t("common.saveFailed")),
        );
      }}
    />
  );
}

export function DeleteProjectDialog({
  open,
  project,
  onClose,
}: {
  open: boolean;
  project: Project;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t("project.deleteTitle", { name: project.name })}>
      <DeleteProject project={project} onClose={onClose} />
    </Dialog>
  );
}

function DeleteProject({ project, onClose }: { project: Project; onClose: () => void }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const match = typed.trim().toUpperCase() === project.key;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!match || busy) return;
    setBusy(true);
    try {
      await remove("projects", project.id);
      onClose();
      navigate("/", true);
    } catch {
      toast(t("common.actionFailed"));
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={submit}>
      <p className={s.text}>{t("project.deleteText", { key: project.key })}</p>
      <input
        className={`input ${s.key}`}
        aria-label={t("project.key")}
        value={typed}
        autoFocus
        onChange={(e) => setTyped(e.target.value)}
      />
      <div className={s.actions}>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button type="submit" variant="danger" disabled={!match || busy}>
          {t("project.delete")}
        </Button>
      </div>
    </form>
  );
}
