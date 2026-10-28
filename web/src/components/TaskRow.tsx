import type { ReactNode } from "react";
import { isClosed, type Project, type Task } from "../api";
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
      <StatusDot status={task.status} />
      <ProjectBadge name={project.name} projectKey={project.key} color={project.color} size={18} />
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

export function TaskList({ children }: { children: ReactNode }) {
  return <div className={s.list}>{children}</div>;
}
