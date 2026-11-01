import type { ReactNode } from "react";
import { iconURL, isClosed, type Project, type Task } from "../api";
import { formatDue, isOverdue } from "../format";
import { useLang, useT } from "../i18n";
import { StatusDot } from "./Board";
import { ProjectBadge } from "./ProjectBadge";
import s from "./TaskRow.module.css";

export function TaskRow({ task, project, href }: { task: Task; project: Project; href: string }) {
  const t = useT();
  const lang = useLang();
  const priority = task.priority === "normal" ? undefined : t(`priority.${task.priority}`);
  const done = isClosed(task.status);
  return (
    <a className={[s.row, s[task.priority]].filter(Boolean).join(" ")} href={href} title={priority}>
      <ProjectBadge
        name={project.name}
        projectKey={project.key}
        color={project.color}
        src={iconURL(project)}
        size={18}
      />
      <span className={s.title}>
        {task.title}
        {priority && <span className="sr">, {priority}</span>}
      </span>
      <span className={isOverdue(task.due) && !done ? `${s.due} ${s.late}` : s.due}>
        {task.due && formatDue(task.due, lang)}
      </span>
      <span className={s.key}>
        {project.key}-{task.number}
      </span>
    </a>
  );
}

export function TaskGroups<T extends Task>({
  tasks,
  row,
}: {
  tasks: T[];
  row: (task: T) => ReactNode;
}) {
  const t = useT();
  const statuses = [...new Set(tasks.map((x) => x.status))];
  return (
    <div className={s.groups}>
      {statuses.map((status) => {
        const group = tasks.filter((x) => x.status === status);
        return (
          <div key={status} className={s.group}>
            <h3 className={s.head}>
              <StatusDot status={status} />
              {t(`status.${status}`)}
              <span className="count">{group.length}</span>
            </h3>
            <div className={s.list}>{group.map(row)}</div>
          </div>
        );
      })}
    </div>
  );
}
