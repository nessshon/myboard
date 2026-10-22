import PocketBase, { ClientResponseError, type RecordModel } from "pocketbase";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { forget, load, save } from "./browser";

const pb = new PocketBase("/");
pb.autoCancellation(false);

export const STATUSES = ["backlog", "todo", "in_progress", "done", "cancelled"] as const;
export const PRIORITIES = ["normal", "high", "urgent"] as const;
export type Status = (typeof STATUSES)[number];
export const isClosed = (status: Status) => status === "done" || status === "cancelled";
const OPEN = "status != 'done' && status != 'cancelled'";
type Priority = (typeof PRIORITIES)[number];

export interface User extends RecordModel {
  tg_id?: string;
  name: string;
  username: string;
  avatar_url: string;
  role: "admin" | "member";
  deleted: boolean;
  last_login: string;
  project_order?: string[] | null;
  notify_off?: string[] | null;
  lang?: "ru" | "en" | "";
  owner?: boolean;
}
export interface Project extends RecordModel {
  name: string;
  description: string;
  key: string;
  members: string[];
  archived: boolean;
  color: string;
}
export interface Label extends RecordModel {
  project: string;
  name: string;
  color: string;
}
export interface Task extends RecordModel {
  project: string;
  number: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  labels: string[];
  assignees: string[];
  due: string;
  position: number;
  author: string;
  edited: string;
}
export interface Note extends RecordModel {
  project: string;
  title: string;
  body: string;
  position: number;
  author: string;
  shared: boolean;
  edited: string;
}
export interface Comment extends RecordModel {
  task: string;
  author: string;
  body: string;
}
export interface ApiToken extends RecordModel {
  name: string;
  hint: string;
  last_used: string;
}

// LocalAuthStore re-parses localStorage on every `record` read, so useSyncExternalStore needs a
// stable snapshot: keep one here and refresh it whenever the store changes.
let me: User | null = pb.authStore.isValid ? (pb.authStore.record as User) : null;
pb.authStore.onChange((_, record) => {
  me = pb.authStore.isValid ? (record as User) : null;
});

function subscribeAuth(f: () => void) {
  return pb.authStore.onChange(f);
}

export function useMe(): User | null {
  return useSyncExternalStore(subscribeAuth, () => me);
}

export async function restoreSession() {
  if (!pb.authStore.isValid) return;
  try {
    await pb.collection("users").authRefresh();
  } catch (err) {
    if (err instanceof ClientResponseError && [401, 403, 404].includes(err.status))
      pb.authStore.clear();
  }
}

export function logout() {
  pb.authStore.clear();
}

export const boot: { version?: string; dev?: boolean; bot?: string } = JSON.parse(
  document.getElementById("boot")?.textContent ?? "{}",
);

export function noAccessId(err: unknown): string | null {
  if (!(err instanceof ClientResponseError) || err.status !== 403) return null;
  const message = err.response?.data?.tg_id?.message;
  return typeof message === "string" ? message.replace(/\D/g, "") || null : null;
}

// Login leaves for Telegram in this tab and returns to /login (pocketbase.io/docs/authentication, manual code
// exchange): Cross-Origin-Opener-Policy keeps the SDK from closing a popup, and a phone may sleep the tab that
// waits for it. Stored in localStorage: Telegram may bring the person back in another tab.
const loginKey = "mb.login";
const loginReturn = () => location.origin + "/login";

export async function loginWithTelegram() {
  const methods = await pb.collection("users").listAuthMethods();
  const telegram = methods.oauth2.providers.find((p) => p.name === "telegram");
  if (!telegram) throw new Error("Telegram login is off");
  save(loginKey, JSON.stringify({ state: telegram.state, verifier: telegram.codeVerifier }));
  location.assign(telegram.authURL + encodeURIComponent(loginReturn()));
}

export async function finishTelegramLogin(code: string | null, state: string | null) {
  const started: { state?: string; verifier?: string } = JSON.parse(load(loginKey) ?? "{}");
  forget(loginKey);
  if (!code || !state || !started.verifier || started.state !== state)
    throw new Error("Telegram did not confirm this login");
  await pb
    .collection("users")
    .authWithOAuth2Code("telegram", code, started.verifier, loginReturn());
}

export async function devUsers(): Promise<{ tg_id: string; name: string; role: string }[]> {
  return pb.send("/api/myboard/dev/users", {});
}

export async function devLogin(tgId: string) {
  const res = await pb.send("/api/myboard/dev/login", {
    method: "POST",
    body: { tg_id: tgId },
  });
  pb.authStore.save(res.token, res.record);
}

export function personName(
  u: Pick<User, "name" | "username" | "tg_id" | "deleted">,
  gone?: string,
) {
  const name = u.name || u.username || u.tg_id || "—";
  return gone && u.deleted ? `${name} (${gone})` : name;
}

export const membersOf = (project: Project, people: User[]) =>
  people.filter((p) => project.members.includes(p.id));

export function inOrder(projects: Project[], order: string[] = []) {
  const at = new Map(order.map((id, i) => [id, i]));
  return [...projects].sort(
    (a, b) =>
      (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity) || a.name.localeCompare(b.name),
  );
}

export const saveProjectOrder = (me: User, ids: string[]) =>
  pb.collection("users").update<User>(me.id, { project_order: ids });

export const saveMe = (me: User, data: Pick<User, "notify_off" | "lang">) =>
  pb.collection("users").update<User>(me.id, data);

export const users = (removed = false) =>
  pb
    .collection("users")
    .getFullList<User>({ filter: removed ? "" : "deleted = false", sort: "name" });

export const projects = () => pb.collection("projects").getFullList<Project>({ sort: "name" });

export const openTaskCounts = async () => {
  const rows = await pb.collection("tasks").getFullList<Pick<Task, "project">>({
    filter: OPEN,
    fields: "project",
  });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.project] = (counts[r.project] ?? 0) + 1;
  return counts;
};

export const myNotes = (userId: string) =>
  pb.collection("notes").getFullList<Note>({
    filter: pb.filter("author = {:id}", { id: userId }),
    sort: "-updated",
  });

export const myOpenCount = async (userId: string) =>
  (
    await pb.collection("tasks").getList(1, 1, {
      filter: pb.filter(`assignees.id ?= {:id} && ${OPEN}`, {
        id: userId,
      }),
      fields: "id",
    })
  ).totalItems;

const OPEN_ORDER: Status[] = ["in_progress", "todo", "backlog"];

export const myOpenTasks = async (userId: string) => {
  const rows = await pb.collection("tasks").getFullList<Task & { expand?: { project?: Project } }>({
    filter: pb.filter(`assignees.id ?= {:id} && ${OPEN}`, {
      id: userId,
    }),
    sort: "position",
    expand: "project",
  });
  return rows.sort(
    (a, b) =>
      OPEN_ORDER.indexOf(a.status) - OPEN_ORDER.indexOf(b.status) ||
      (a.due || "9999").localeCompare(b.due || "9999"),
  );
};

export function onChanges(collections: string[], reload: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(reload, 300);
  };
  const stops = collections.map((c) => pb.collection(c).subscribe("*", later));
  return () => {
    clearTimeout(timer);
    stops.forEach((s) => s.then((stop) => stop()).catch(() => {}));
  };
}

function live<T extends RecordModel>(
  collection: string,
  filter: string,
  sort: string,
  set: Dispatch<SetStateAction<T[] | null>>,
  failed: () => void,
) {
  let alive = true;
  pb.collection(collection)
    .getFullList<T>({ filter, sort })
    .then((rows) => alive && set(rows))
    .catch(() => alive && failed());
  const unsubscribe = pb.collection(collection).subscribe<T>(
    "*",
    ({ action, record }) =>
      set((rows) => {
        if (!rows) return rows;
        const rest = rows.filter((r) => r.id !== record.id);
        return action === "delete" ? rest : [...rest, record];
      }),
    { filter },
  );
  return () => {
    alive = false;
    unsubscribe.then((stop) => stop()).catch(() => {});
  };
}

export function useProjectData(projectId: string | undefined, failed: () => void) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);

  useEffect(() => {
    if (!projectId) return;
    const filter = pb.filter("project = {:id}", { id: projectId });
    const stops = [
      live("tasks", filter, "position", setTasks, failed),
      live("notes", filter, "position", setNotes, failed),
      live("labels", filter, "name", setLabels, failed),
      live(
        "comments",
        pb.filter("task.project = {:id}", { id: projectId }),
        "created",
        setComments,
        failed,
      ),
    ];
    return () => {
      stops.forEach((stop) => stop());
      setTasks(null);
      setNotes(null);
      setLabels(null);
      setComments(null);
    };
  }, [projectId]);

  return { tasks, notes, labels, comments, setTasks, setNotes, setLabels, setComments };
}

type Writable = "projects" | "tasks" | "notes" | "labels" | "comments";

export const create = <T extends RecordModel>(
  collection: Writable,
  data: Record<string, unknown>,
) => pb.collection(collection).create<T>(data);

export const update = <T extends RecordModel>(
  collection: Writable,
  id: string,
  patch: Record<string, unknown>,
) => pb.collection(collection).update<T>(id, patch);

export const remove = (collection: Writable | "api_tokens", id: string) =>
  pb.collection(collection).delete(id);

export const addUser = (tg_id: string, role: User["role"]) =>
  pb.send<User>("/api/myboard/users", { method: "POST", body: { tg_id, role } });

export const removeUser = (id: string) =>
  pb.send(`/api/myboard/users/${id}/remove`, { method: "POST" });

export const setRole = (id: string, role: User["role"]) =>
  pb.collection("users").update<User>(id, { role });

export const tokens = () => pb.collection("api_tokens").getFullList<ApiToken>({ sort: "-created" });

export const createToken = (name: string) =>
  pb.send<ApiToken & { token: string }>("/api/myboard/tokens", { method: "POST", body: { name } });

const STEP = 1024;

export function positionAt(column: { position: number }[], index: number): number | null {
  const prev = column[index - 1]?.position;
  const next = column[index]?.position;
  if (next === undefined) return prev === undefined ? 0 : prev + STEP;
  if (prev === undefined) return next - STEP;
  return next - prev < 1e-6 ? null : (prev + next) / 2;
}

export function indexAmong<T>(column: T[], shown: T[], index: number) {
  if (index < shown.length) return column.indexOf(shown[index]);
  return shown.length ? column.indexOf(shown[shown.length - 1]) + 1 : column.length;
}

export async function renumber(collection: "tasks" | "notes", ids: string[]) {
  const batch = pb.createBatch();
  ids.forEach((id, i) => batch.collection(collection).update(id, { position: i * STEP }));
  await batch.send();
  return ids.map((id, i) => ({ id, position: i * STEP }));
}

export type Row = Task | Note;
export type Setter<T> = Dispatch<SetStateAction<T[] | null>>;

function put<T extends Row | Label | Comment>(set: Setter<T>, row: T) {
  set((rows) => rows && [...rows.filter((r) => r.id !== row.id), row]);
}

export async function patch<T extends Row | Label | Comment>(
  collection: "tasks" | "notes" | "labels" | "comments",
  set: Setter<T>,
  old: T | undefined,
  data: Partial<T>,
  fail: () => void,
) {
  if (!old) return;
  put(set, { ...old, ...data });
  try {
    put(set, await update<T>(collection, old.id, data));
  } catch {
    const back = Object.fromEntries(Object.keys(data).map((k) => [k, old[k as keyof T]]));
    set((rows) => rows && rows.map((r) => (r.id === old.id ? { ...r, ...back } : r)));
    fail();
  }
}

export async function add<T extends Row | Label | Comment>(
  collection: "tasks" | "notes" | "labels" | "comments",
  set: Setter<T>,
  data: Record<string, unknown>,
  fail: () => void,
) {
  try {
    const row = await create<T>(collection, data);
    put(set, row);
    return row;
  } catch {
    fail();
  }
}

export async function drop<T extends Row | Label | Comment>(
  collection: "tasks" | "notes" | "labels" | "comments",
  set: Setter<T>,
  old: T | undefined,
  fail: () => void,
) {
  if (!old) return;
  set((rows) => rows && rows.filter((r) => r.id !== old.id));
  try {
    await remove(collection, old.id);
  } catch {
    put(set, old);
    fail();
  }
}
