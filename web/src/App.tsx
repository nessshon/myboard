import { useEffect, useState, type ReactNode } from "react";
import {
  saveMe,
  myOpenCount,
  openTaskCounts,
  onChanges,
  projects as listProjects,
  restoreSession,
  useMe,
  users as listUsers,
  type Project,
  type User,
} from "./api";
import { AppShell } from "./components/AppShell";
import { NewProjectDialog } from "./components/ProjectDialogs";
import { ProjectMembers, ProjectMenu } from "./components/ProjectHeader";
import { toast, Toaster } from "./components/Toast";
import { useLang, useT } from "./i18n";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { MyTasksPage } from "./pages/MyTasksPage";
import { ProjectPage } from "./pages/ProjectPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { UsersPage } from "./pages/UsersPage";
import { navigate, useRoute } from "./router";
import s from "./App.module.css";

export function App() {
  const me = useMe();
  const route = useRoute();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    restoreSession().finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!me && route.name !== "login") navigate("/login", true);
    if (me && route.name === "login") navigate("/", true);
  }, [ready, me, route.name]);

  if (!ready) return null;
  return (
    <>
      {me && route.name !== "login" ? <Workspace key={me.id} me={me} /> : <LoginPage />}
      <Toaster />
    </>
  );
}

function Workspace({ me }: { me: User }) {
  const t = useT();
  const lang = useLang();
  const route = useRoute();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [people, setPeople] = useState<User[]>([]);
  const [myCount, setMyCount] = useState(0);
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const failed = () => toast(t("common.loadFailed"));
    const reloadProjects = () => listProjects().then(setProjects).catch(failed);
    const reloadPeople = () => listUsers(true).then(setPeople).catch(failed);
    reloadProjects();
    reloadPeople();
    const stopProjects = onChanges(["projects"], reloadProjects);
    const stopPeople = onChanges(["users"], reloadPeople);
    return () => {
      stopProjects();
      stopPeople();
    };
  }, []);

  useEffect(() => {
    const recount = () => {
      myOpenCount(me.id)
        .then(setMyCount)
        .catch(() => {});
      openTaskCounts()
        .then(setOpenCounts)
        .catch(() => {});
    };
    recount();
    return onChanges(["tasks"], recount);
  }, [me.id]);

  useEffect(() => {
    if (me.lang !== lang) saveMe(me, { lang }).catch(() => {});
  }, [lang, me.lang]);

  useEffect(() => {
    if (route.name === "users" && me.role !== "admin") navigate("/", true);
  }, [route.name, me.role]);

  const key = "key" in route ? route.key : undefined;
  const project = projects?.find((p) => p.key.toLowerCase() === key);

  const pageNames: Partial<Record<typeof route.name, string>> = {
    my: t("nav.myTasks"),
    users: t("users.title"),
    integrations: t("nav.integrations"),
  };
  const page =
    route.name === "task" && project
      ? `${project.key}-${route.number} · ${project.name}`
      : route.name === "project"
        ? project?.name
        : pageNames[route.name];
  useEffect(() => {
    document.title = page ? `${page} · myboard` : "myboard";
  }, [page]);

  let title: ReactNode = "myboard";
  let extra: ReactNode = null;
  let content: ReactNode = null;

  switch (route.name) {
    case "project":
    case "task":
      if (!projects) break;
      if (!project) {
        content = <p className={s.message}>{t("common.notFound")}</p>;
        break;
      }
      title = <ProjectMenu me={me} project={project} people={people} />;
      extra = <ProjectMembers project={project} people={people} />;
      content = (
        <ProjectPage
          key={project.id}
          me={me}
          project={project}
          people={people}
          taskNumber={route.name === "task" ? route.number : undefined}
        />
      );
      break;
    case "home":
      title = t("home.title");
      content = (
        <HomePage
          me={me}
          projects={projects}
          people={people}
          openCounts={openCounts}
          task={"task" in route ? route.task : undefined}
          onNewProject={() => setCreating(true)}
        />
      );
      break;
    case "my":
      title = t("nav.myTasks");
      content = (
        <MyTasksPage
          me={me}
          projects={projects ?? []}
          people={people}
          task={"task" in route ? route.task : undefined}
        />
      );
      break;
    case "users":
      title = t("users.title");
      content = me.role === "admin" && <UsersPage me={me} />;
      break;
    case "integrations":
      title = t("nav.integrations");
      content = <IntegrationsPage />;
      break;
    default:
      content = <p className={s.message}>{t("common.notFound")}</p>;
  }

  return (
    <AppShell
      me={me}
      projects={projects ?? []}
      activeKey={project?.key}
      myCount={myCount}
      onNewProject={() => setCreating(true)}
      title={title}
      headerExtra={extra}
    >
      {content}
      <NewProjectDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(p) => {
          setCreating(false);
          navigate(`/p/${p.key.toLowerCase()}`);
        }}
      />
    </AppShell>
  );
}
