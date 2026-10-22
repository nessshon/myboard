import { useEffect, useId, useMemo, useState } from "react";
import {
  add,
  membersOf,
  indexAmong,
  personName,
  positionAt,
  renumber,
  useProjectData,
  patch,
  drop,
  type Row,
  type Setter,
  type Project,
  type Status,
  type Task,
  type User,
} from "../api";
import { usePhone } from "../browser";
import { Avatar } from "../components/Avatar";
import { Board, MobileBoard } from "../components/Board";
import { Button } from "../components/Button";
import { Filter, FilterReset, type FilterOption } from "../components/Filter";
import { Icon } from "../components/Icon";
import { LabelsDialog } from "../components/LabelsDialog";
import { MenuItem, MenuSeparator } from "../components/Menu";
import { Notes } from "../components/Notes";
import { restoreProject } from "../components/ProjectHeader";
import { TaskDialog, type TaskFields } from "../components/TaskDialog";
import { toast } from "../components/Toast";
import { useT } from "../i18n";
import { navigate } from "../router";
import s from "./ProjectPage.module.css";

const byPosition = (a: Row, b: Row) => a.position - b.position;

type TaskFilter = { assignee: string[]; author: string[]; labels: string[] };
const noFilter: TaskFilter = { assignee: [], author: [], labels: [] };

const peopleOf = (task: Task, field: "assignee" | "author") =>
  field === "assignee" ? task.assignees : [task.author];

const fits = (task: Task, only: TaskFilter, skip?: keyof TaskFilter) =>
  (skip === "assignee" ||
    !only.assignee.length ||
    only.assignee.some((id) => (id ? task.assignees.includes(id) : !task.assignees.length))) &&
  (skip === "author" || !only.author.length || only.author.includes(task.author)) &&
  (skip === "labels" || !only.labels.length || task.labels.some((l) => only.labels.includes(l)));

async function move<T extends Row>(
  collection: "tasks" | "notes",
  set: Setter<T>,
  group: T[],
  old: T | undefined,
  index: number,
  extra: Partial<T>,
  fail: () => void,
) {
  let position = positionAt(group, index);
  if (position === null) {
    try {
      const fresh = await renumber(
        collection,
        group.map((r) => r.id),
      );
      set(
        (rows) =>
          rows &&
          rows.map((r) => ({
            ...r,
            position: fresh.find((f) => f.id === r.id)?.position ?? r.position,
          })),
      );
      position = positionAt(fresh, index)!;
    } catch {
      fail();
      return;
    }
  }
  await patch(collection, set, old, { ...extra, position }, fail);
}

export function ProjectPage({
  me,
  project,
  people,
  taskNumber,
}: {
  me: User;
  project: Project;
  people: User[];
  taskNumber?: number;
}) {
  const t = useT();
  const tasksHead = useId();
  const { tasks, notes, labels, setTasks, setNotes, setLabels } = useProjectData(project.id, () =>
    toast(t("common.loadFailed")),
  );
  const isPhone = usePhone();
  const [creating, setCreating] = useState(false);
  const [picked, setOnly] = useState(noFilter);
  const [editingLabels, setEditingLabels] = useState(false);

  const base = `/p/${project.key.toLowerCase()}`;
  const sortedTasks = useMemo(() => tasks && [...tasks].sort(byPosition), [tasks]);
  const sortedNotes = useMemo(() => notes && [...notes].sort(byPosition), [notes]);
  const sortedLabels = useMemo(
    () => labels && [...labels].sort((a, b) => a.name.localeCompare(b.name)),
    [labels],
  );
  const members = membersOf(project, people);
  const only = useMemo(() => {
    if (!labels || !tasks) return picked;
    const known = (field: "assignee" | "author") =>
      new Set([...project.members, ...tasks.flatMap((x) => peopleOf(x, field))]);
    const assignees = known("assignee");
    const authors = known("author");
    return {
      assignee: picked.assignee.filter((id) => id === "" || assignees.has(id)),
      author: picked.author.filter((id) => authors.has(id)),
      labels: picked.labels.filter((id) => labels.some((l) => l.id === id)),
    };
  }, [picked, labels, tasks, project.members]);
  const filtering = !!(only.assignee.length || only.author.length || only.labels.length);
  const shownTasks = useMemo(
    () => sortedTasks && (filtering ? sortedTasks.filter((x) => fits(x, only)) : sortedTasks),
    [sortedTasks, only, filtering],
  );
  const open = taskNumber === undefined ? undefined : tasks?.find((x) => x.number === taskNumber);

  useEffect(() => {
    if (!tasks || taskNumber === undefined || open) return;
    toast(t("common.notFound"));
    navigate(base, true);
  }, [tasks, taskNumber, open, base]);

  const failed = () => toast(t("common.saveFailed"));
  const actionFailed = () => toast(t("common.actionFailed"));
  const findTask = (id: string) => tasks?.find((x) => x.id === id);
  const findNote = (id: string) => notes?.find((x) => x.id === id);

  const moveTask = (id: string, status: Status, index: number) => {
    const column = sortedTasks!.filter((x) => x.status === status && x.id !== id);
    const shown = shownTasks!.filter((x) => x.status === status && x.id !== id);
    return move(
      "tasks",
      setTasks,
      column,
      findTask(id),
      indexAmong(column, shown, index),
      { status },
      failed,
    );
  };

  const moveNote = (id: string, index: number) =>
    move(
      "notes",
      setNotes,
      sortedNotes!.filter((x) => x.id !== id),
      findNote(id),
      index,
      {},
      failed,
    );

  async function createTask(fields: TaskFields) {
    const row = await add("tasks", setTasks, { ...fields, project: project.id }, actionFailed);
    if (!row) return;
    setCreating(false);
    navigate(`${base}/${row.number}`);
  }

  const createNote = (draft: { title: string; body: string }) =>
    add("notes", setNotes, { ...draft, project: project.id }, actionFailed);

  const createLabel = (name: string, color: string) =>
    add("labels", setLabels, { project: project.id, name, color }, actionFailed);

  const card = { projectKey: project.key, labels: sortedLabels ?? [], people };

  const countOf = (skip: keyof TaskFilter, test: (x: Task) => boolean) =>
    (sortedTasks ?? []).filter((x) => fits(x, only, skip) && test(x)).length;
  const personOptions = (field: "assignee" | "author"): FilterOption[] => {
    const ids = new Set([
      ...project.members,
      ...(sortedTasks ?? []).flatMap((x) => peopleOf(x, field)),
    ]);
    const pool = people.filter((p) => ids.has(p.id));
    return [...pool.filter((p) => p.id === me.id), ...pool.filter((p) => p.id !== me.id)].map(
      (p) => ({
        id: p.id,
        name: personName(p, t("users.gone")),
        icon: <Avatar name={personName(p)} src={p.avatar_url} size={18} />,
        count: countOf(field, (x) => peopleOf(x, field).includes(p.id)),
      }),
    );
  };

  return (
    <div className={s.page}>
      {project.archived && (
        <div className={s.banner}>
          <Icon name="archive" />
          <span className={s.bannerText}>{t("project.archivedBanner")}</span>
          {me.role === "admin" && (
            <Button size="sm" onClick={() => restoreProject(project, t)}>
              {t("project.restore")}
            </Button>
          )}
        </div>
      )}

      <div className={s.notes}>
        <Notes
          me={me}
          notes={sortedNotes}
          people={people}
          isPhone={isPhone}
          onMove={moveNote}
          onCreate={createNote}
          onPatch={(id, data) => patch("notes", setNotes, findNote(id), data, failed)}
          onDelete={(id) => drop("notes", setNotes, findNote(id), actionFailed)}
        />
      </div>

      <section className={s.tasks} aria-labelledby={tasksHead}>
        <div className={s.head}>
          <h2 id={tasksHead} className="heading">
            {t("project.tasks")}
            {sortedTasks && <span className="count">{sortedTasks.length}</span>}
          </h2>
          <Button size="sm" variant="primary" icon="plus" compact onClick={() => setCreating(true)}>
            {t("task.new")}
          </Button>
        </div>
        {sortedTasks && (sortedTasks.length > 0 || filtering || !!sortedLabels?.length) && (
          <div className={s.filters}>
            <Filter
              title={t("task.assignees")}
              chosen={only.assignee}
              onChange={(assignee) => setOnly({ ...only, assignee })}
              options={[
                ...personOptions("assignee"),
                {
                  id: "",
                  name: t("task.unassigned"),
                  icon: (
                    <span className={s.nobody}>
                      <Icon name="userRound" size={12} strokeWidth={2.4} />
                    </span>
                  ),
                  count: countOf("assignee", (x) => !x.assignees.length),
                },
              ]}
            />
            <Filter
              title={t("task.author")}
              chosen={only.author}
              onChange={(author) => setOnly({ ...only, author })}
              options={personOptions("author")}
            />
            {!!sortedLabels?.length && (
              <Filter
                title={t("task.labels")}
                chosen={only.labels}
                onChange={(labels) => setOnly({ ...only, labels })}
                options={sortedLabels.map((l) => ({
                  id: l.id,
                  name: l.name,
                  icon: <span className={s.swatch} style={{ background: l.color }} />,
                  count: countOf("labels", (x) => x.labels.includes(l.id)),
                }))}
              >
                <MenuSeparator />
                <MenuItem icon="pencil" onClick={() => setEditingLabels(true)}>
                  {t("label.manage")}
                </MenuItem>
              </Filter>
            )}
            {filtering && <FilterReset onClick={() => setOnly(noFilter)} />}
          </div>
        )}
        {filtering && shownTasks?.length === 0 ? (
          <p className={s.nothing}>{t("filter.noTasks")}</p>
        ) : (
          sortedTasks &&
          (isPhone ? (
            <MobileBoard tasks={shownTasks!} onMove={moveTask} {...card} />
          ) : (
            <Board tasks={shownTasks!} onMove={moveTask} {...card} />
          ))
        )}
      </section>

      <TaskDialog
        open={creating || !!open}
        task={creating ? undefined : open}
        projectKey={project.key}
        labels={sortedLabels ?? []}
        members={members}
        people={people}
        onClose={() => (creating ? setCreating(false) : navigate(base))}
        onPatch={(data) => patch("tasks", setTasks, open, data, failed)}
        onCreate={createTask}
        onDelete={() => {
          navigate(base);
          drop("tasks", setTasks, open, actionFailed);
        }}
        onCreateLabel={createLabel}
      />
      <LabelsDialog
        open={editingLabels}
        onClose={() => setEditingLabels(false)}
        labels={sortedLabels ?? []}
        tasks={sortedTasks ?? []}
        onChange={(label, data) => patch("labels", setLabels, label, data, failed)}
        onDelete={(label) => drop("labels", setLabels, label, actionFailed)}
      />
    </div>
  );
}
