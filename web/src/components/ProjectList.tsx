import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRef } from "react";
import type { Project } from "../api";
import { useT } from "../i18n";
import { projectPath } from "../router";
import { useDragSensors } from "./Board";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { ProjectBadge } from "./ProjectBadge";
import s from "./AppShell.module.css";

type Props = {
  projects: Project[];
  activeKey?: string;
  drag?: "row" | "handle";
  onMove: (id: string, index: number) => void;
  onEdit?: (project: Project) => void;
};

export function ProjectList({ projects, activeKey, drag, onMove, onEdit }: Props) {
  const sensors = useDragSensors();
  const dragged = useRef(false);

  function end({ active, over }: DragEndEvent) {
    setTimeout(() => (dragged.current = false));
    if (!over || active.id === over.id) return;
    onMove(
      String(active.id),
      projects.findIndex((p) => p.id === over.id),
    );
  }

  const rows = projects.map((pr) => (
    <Row
      key={pr.id}
      project={pr}
      current={pr.key === activeKey}
      drag={drag}
      dragged={dragged}
      onEdit={onEdit}
    />
  ));
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => (dragged.current = true)}
      onDragCancel={() => (dragged.current = false)}
      onDragEnd={end}
    >
      <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        {rows}
      </SortableContext>
    </DndContext>
  );
}

function Row({
  project,
  current,
  drag,
  dragged,
  onEdit,
}: {
  project: Project;
  current: boolean;
  drag?: "row" | "handle";
  dragged: { current: boolean };
  onEdit?: (project: Project) => void;
}) {
  const t = useT();
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id, disabled: !drag });
  return (
    <div
      ref={setNodeRef}
      className={isDragging ? `${s.prow} ${s.lifted}` : s.prow}
      style={{ transform: CSS.Translate.toString(transform && { ...transform, x: 0 }), transition }}
    >
      {drag === "handle" && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className={s.grip}
          {...attributes}
          {...listeners}
          aria-label={t("nav.dragProject")}
          title={t("nav.dragProject")}
        >
          <Icon name="grip" size={18} />
        </button>
      )}
      <a
        href={projectPath(project.key)}
        className={s.item}
        aria-current={current ? "page" : undefined}
        title={project.name}
        // The browser drags links on its own and opens one dropped on the page, which reloads it
        // in the middle of our drag; only dnd-kit may move the row.
        draggable={false}
        {...(drag === "row" ? listeners : {})}
        onClickCapture={(e) => {
          if (!dragged.current) return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <ProjectBadge
          name={project.name}
          projectKey={project.key}
          color={project.color}
          size={22}
        />
        <span className={`ellipsis ${s.text}`}>{project.name}</span>
      </a>
      {onEdit && (
        <Button
          size="sm"
          icon="more"
          className={s.more}
          aria-label={`${t("project.edit")}: ${project.name}`}
          onClick={() => onEdit(project)}
        />
      )}
    </div>
  );
}
