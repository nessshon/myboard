import { useEffect, useState } from "react";
import {
  membersOf,
  drop,
  myNotes,
  myOpenTasks,
  patch,
  onChanges,
  type Note,
  type Project,
  type User,
  personName,
} from "../api";
import { usePhone } from "../browser";
import { Avatar } from "../components/Avatar";
import { Button, LinkButton } from "../components/Button";
import { Notes } from "../components/Notes";
import { OpenTask } from "../components/OpenTask";
import { ProjectBadge } from "../components/ProjectBadge";
import { Section } from "../components/Section";
import { TaskList, TaskRow } from "../components/TaskRow";
import { toast } from "../components/Toast";
import { useT } from "../i18n";
import { navigate } from "../router";
import s from "./HomePage.module.css";

const SHOWN = 5;

export function HomePage({
  me,
  projects,
  people,
  openCounts,
  task,
  onNewProject,
}: {
  me: User;
  projects: Project[] | null;
  people: User[];
  openCounts: Record<string, number>;
  task?: { key: string; number: number };
  onNewProject: () => void;
}) {
  const t = useT();
  const isPhone = usePhone();
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof myOpenTasks>> | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const active = projects?.filter((p) => !p.archived) ?? null;
  const open = task && projects?.find((p) => p.key.toLowerCase() === task.key);
  const isAdmin = me.role === "admin";

  useEffect(() => {
    if (!task || !projects || open) return;
    toast(t("common.notFound"));
    navigate("/", true);
  }, [task, projects, open]);

  useEffect(() => {
    const loadFailed = () => toast(t("common.loadFailed"));
    const reloadTasks = () => myOpenTasks(me.id).then(setTasks).catch(loadFailed);
    const reloadNotes = () => myNotes(me.id).then(setNotes).catch(loadFailed);
    reloadTasks();
    reloadNotes();
    const stopTasks = onChanges(["tasks"], reloadTasks);
    const stopNotes = onChanges(["notes"], reloadNotes);
    return () => {
      stopTasks();
      stopNotes();
    };
  }, [me.id]);

  const failed = () => toast(t("common.saveFailed"));
  const findNote = (id: string) => notes?.find((n) => n.id === id);
  const rows = tasks?.filter((x) => x.expand?.project) ?? null;

  if (!rows || !active || !notes) return null;
  return (
    <div className="page">
      {open && (
        <OpenTask key={open.id} project={open} number={task!.number} people={people} back="/" />
      )}

      <Section
        title={t("project.tasks")}
        count={rows.length}
        action={
          rows.length > SHOWN && (
            <LinkButton size="sm" href="/tasks">
              {t("home.allMine")}
            </LinkButton>
          )
        }
      >
        {rows.length === 0 && <div className="empty">{t("my.empty")}</div>}
        {rows.length > 0 && (
          <TaskList>
            {rows.slice(0, SHOWN).map((x) => {
              const pr = x.expand!.project!;
              return (
                <TaskRow
                  key={x.id}
                  task={x}
                  project={pr}
                  href={`/${pr.key.toLowerCase()}-${x.number}`}
                />
              );
            })}
          </TaskList>
        )}
      </Section>

      <Section
        title={t("nav.projects")}
        count={active.length}
        action={
          isAdmin && (
            <Button size="sm" icon="plus" onClick={onNewProject}>
              {t("home.newProject")}
            </Button>
          )
        }
      >
        {active.length === 0 && (
          <div className="empty">{t(isAdmin ? "home.emptyAdmin" : "home.emptyMember")}</div>
        )}
        {active.length > 0 && (
          <div className={s.projects}>
            {active.map((p) => (
              <a key={p.id} className={s.card} href={`/p/${p.key.toLowerCase()}`}>
                <span className={s.top}>
                  <ProjectBadge name={p.name} projectKey={p.key} color={p.color} size={32} />
                  <span className={s.name}>{p.name}</span>
                </span>
                <span className="clamp">{p.description}</span>
                <span className={s.foot}>
                  <span>{t("home.openTasks", { count: openCounts[p.id] ?? 0 })}</span>
                  <span className={s.people}>
                    {membersOf(p, people)
                      .slice(0, 5)
                      .map((u) => (
                        <Avatar key={u.id} name={personName(u)} src={u.avatar_url} size={22} />
                      ))}
                  </span>
                </span>
              </a>
            ))}
          </div>
        )}
      </Section>

      <Notes
        me={me}
        notes={notes}
        people={people}
        isPhone={isPhone}
        projects={projects ?? []}
        onPatch={(id, data) => patch("notes", setNotes, findNote(id), data, failed)}
        onDelete={(id) => drop("notes", setNotes, findNote(id), failed)}
      />
    </div>
  );
}
