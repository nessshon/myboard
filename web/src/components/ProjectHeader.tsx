import { useState } from "react";
import { membersOf, update, useMe, type Project, type User, personName } from "../api";
import { useT } from "../i18n";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { ProjectBadge } from "./ProjectBadge";
import {
  ArchiveDialog,
  DeleteProjectDialog,
  EditProjectDialog,
  MembersDialog,
} from "./ProjectDialogs";
import { toast } from "./Toast";
import s from "./ProjectHeader.module.css";

type Open = "edit" | "members" | "archive" | "delete" | null;

export function ProjectMenu({
  me,
  project,
  people,
}: {
  me: User;
  project: Project;
  people: User[];
}) {
  const t = useT();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const badge = (
    <ProjectBadge name={project.name} projectKey={project.key} color={project.color} size={22} />
  );

  if (me.role !== "admin")
    return (
      <h1 className={s.plain}>
        {badge}
        <span className={s.name}>{project.name}</span>
      </h1>
    );

  return (
    <div role="heading" aria-level={1} className={s.heading}>
      <Menu
        label={project.name}
        align="left"
        triggerClass={s.trigger}
        trigger={
          <>
            {badge}
            <span className={s.name}>{project.name}</span>
            <Icon name="chevronDown" size={14} className={s.chev} />
          </>
        }
      >
        <MenuItem icon="pencil" onClick={() => setOpen("edit")}>
          {t("project.edit")}
        </MenuItem>
        <MenuItem icon="users" onClick={() => setOpen("members")}>
          {t("project.membersTitle")}
        </MenuItem>
        {project.archived ? (
          <MenuItem icon="archiveRestore" onClick={() => restoreProject(project, t)}>
            {t("project.restore")}
          </MenuItem>
        ) : (
          <MenuItem icon="archive" onClick={() => setOpen("archive")}>
            {t("project.archive")}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon="trash" danger onClick={() => setOpen("delete")}>
          {t("project.delete")}
        </MenuItem>
      </Menu>
      <EditProjectDialog open={open === "edit"} project={project} onClose={close} />
      <MembersDialog open={open === "members"} project={project} people={people} onClose={close} />
      <ArchiveDialog open={open === "archive"} project={project} onClose={close} />
      <DeleteProjectDialog open={open === "delete"} project={project} onClose={close} />
    </div>
  );
}

export function restoreProject(project: Project, t: ReturnType<typeof useT>) {
  update("projects", project.id, { archived: false }).catch(() => toast(t("common.saveFailed")));
}

export function ProjectMembers({ project, people }: { project: Project; people: User[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const me = useMe();
  const members = membersOf(project, people);
  if (members.length === 0) return null;

  const stack = members.slice(0, 5).map((m) => (
    <span key={m.id} className={s.ava} title={m.name}>
      <Avatar name={personName(m)} src={m.avatar_url} size={24} />
    </span>
  ));
  return (
    <>
      <button
        type="button"
        className={s.stack}
        aria-label={`${t("project.membersTitle")}: ${members.length}`}
        title={t("project.membersTitle")}
        onClick={() => setOpen(true)}
      >
        {stack}
        {members.length > 5 && <span className={s.more}>+{members.length - 5}</span>}
      </button>
      <MembersDialog
        open={open}
        project={project}
        people={people}
        readOnly={me?.role !== "admin"}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
