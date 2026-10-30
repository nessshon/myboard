import { useEffect, useState } from "react";
import { myOpenTasks, onChanges, type Project, type User } from "../api";
import { OpenTask } from "../components/OpenTask";
import { Section } from "../components/Section";
import { TaskList, TaskRow } from "../components/TaskRow";
import { toast } from "../components/Toast";
import { useT } from "../i18n";
import { navigate } from "../router";

export function MyTasksPage({
  me,
  projects,
  people,
  task,
}: {
  me: User;
  projects: Project[];
  people: User[];
  task?: { key: string; number: number };
}) {
  const t = useT();
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof myOpenTasks>> | null>(null);
  const project = task && projects.find((p) => p.key.toLowerCase() === task.key);

  useEffect(() => {
    if (!task || !projects.length || project) return;
    toast(t("common.notFound"));
    navigate("/tasks", true);
  }, [task, projects.length, project]);

  useEffect(() => {
    const reload = () =>
      myOpenTasks(me.id)
        .then(setTasks)
        .catch(() => toast(t("common.loadFailed")));
    reload();
    return onChanges(["tasks"], reload);
  }, [me.id]);

  if (!tasks) return null;
  const rows = tasks.filter((x) => x.expand?.project);
  return (
    <div className="page">
      {project && (
        <OpenTask
          key={project.id}
          project={project}
          number={task!.number}
          people={people}
          back="/tasks"
        />
      )}
      <Section title={t("project.tasks")} count={rows.length}>
        {rows.length === 0 ? (
          <div className="empty">{t("my.empty")}</div>
        ) : (
          <TaskList>
            {rows.map((x) => {
              const pr = x.expand!.project!;
              return (
                <TaskRow
                  key={x.id}
                  task={x}
                  project={pr}
                  href={`/tasks/${pr.key.toLowerCase()}-${x.number}`}
                />
              );
            })}
          </TaskList>
        )}
      </Section>
    </div>
  );
}
