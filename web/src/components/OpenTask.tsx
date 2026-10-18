import { useEffect, useMemo } from "react";
import { add, membersOf, drop, patch, useProjectData, type Project, type User } from "../api";
import { useT } from "../i18n";
import { navigate } from "../router";
import { TaskDialog } from "./TaskDialog";
import { toast } from "./Toast";

export function OpenTask({
  project,
  number,
  people,
  back,
}: {
  project: Project;
  number: number;
  people: User[];
  back: string;
}) {
  const t = useT();
  const { tasks, labels, setTasks, setLabels } = useProjectData(project.id, () =>
    toast(t("common.loadFailed")),
  );
  const sortedLabels = useMemo(
    () => labels && [...labels].sort((a, b) => a.name.localeCompare(b.name)),
    [labels],
  );
  const members = membersOf(project, people);
  const open = tasks?.find((x) => x.number === number);

  useEffect(() => {
    if (!tasks || open) return;
    toast(t("common.notFound"));
    navigate(back, true);
  }, [tasks, open]);

  const failed = () => toast(t("common.saveFailed"));

  const createLabel = (name: string, color: string) =>
    add("labels", setLabels, { project: project.id, name, color }, failed);

  return (
    <TaskDialog
      open={!!open}
      task={open}
      projectKey={project.key}
      labels={sortedLabels ?? []}
      members={members}
      people={people}
      onClose={() => navigate(back)}
      onPatch={(data) => patch("tasks", setTasks, open, data, failed)}
      onDelete={() => {
        navigate(back);
        drop("tasks", setTasks, open, failed);
      }}
      onCreateLabel={createLabel}
    />
  );
}
