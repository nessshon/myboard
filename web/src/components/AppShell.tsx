import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  boot,
  inOrder,
  logout,
  personName,
  saveProjectOrder,
  type Project,
  type User,
} from "../api";
import { setLang, useLang, useT } from "../i18n";
import { navigate, useRoute } from "../router";
import { load, save } from "../browser";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { ConfirmDialog, EditProjectDialog } from "./ProjectDialogs";
import { ProjectList } from "./ProjectList";
import { ThemeSwitch } from "./ThemeSwitch";
import { toast } from "./Toast";
import s from "./AppShell.module.css";

type Props = {
  me: User;
  projects: Project[];
  activeKey?: string;
  myCount: number;
  onNewProject: () => void;
  title: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
};

// Closing slides the drawer out from wherever it is (a finger may have dragged it half way), then
// closes it. Safari cannot animate a dialog leaving the top layer, so CSS alone would cut it short.
function slideOut(d: HTMLDialogElement) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const from = getComputedStyle(d).transform;
  const opts = { duration: reduce ? 0 : 200, easing: "ease", fill: "forwards" as const };
  const slide = d.animate([{ transform: from }, { transform: "translateX(-100%)" }], opts);
  d.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, pseudoElement: "::backdrop" });
  // onfinish, not .finished: reopening mid-slide cancels the slide, and then nothing must close.
  slide.onfinish = () => {
    d.close();
    d.style.transform = "";
    d.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  };
}

export function AppShell(p: Props) {
  const t = useT();
  const lang = useLang();
  const route = useRoute();
  const [wide, setWide] = useState(load("mb.side") !== "mini");
  const hasArchive = p.projects.some((pr) => pr.archived);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archive = archiveOpen && hasArchive;
  const [order, setOrder] = useState(p.me.project_order ?? []);
  useEffect(() => setOrder(p.me.project_order ?? []), [p.me.project_order]);
  const shown = archive
    ? p.projects.filter((pr) => pr.archived).sort((a, b) => a.name.localeCompare(b.name))
    : inOrder(
        p.projects.filter((pr) => !pr.archived),
        order,
      );
  const [editing, setEditing] = useState<Project | null>(null);

  function move(id: string, index: number) {
    const ids = shown.map((pr) => pr.id).filter((x) => x !== id);
    ids.splice(index, 0, id);
    const before = order;
    setOrder(ids);
    saveProjectOrder(p.me, ids).catch(() => {
      setOrder(before);
      toast(t("common.saveFailed"));
    });
  }
  const isAdmin = p.me.role === "admin";
  const myLabel = t("nav.myTasksCount", { count: p.myCount });

  function toggle() {
    save("mb.side", wide ? "mini" : "wide");
    setWide(!wide);
  }

  const [drawer, setDrawer] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);

  useEffect(() => setDrawer(false), [route]);

  useEffect(() => {
    const d = drawerRef.current!;
    if (!drawer) {
      if (d.open) slideOut(d);
      return;
    }
    d.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    if (!d.open) d.showModal();
    // showModal() focuses the first link, the logo, whose focus ring the panel edge cuts into a stray
    // line; the drawer itself takes focus instead, Tab still reaches every link.
    d.focus();
    d.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
    const wideScreen = matchMedia("(min-width: 641px)");
    const close = () => setDrawer(false);
    wideScreen.addEventListener("change", close);
    return () => wideScreen.removeEventListener("change", close);
  }, [drawer]);

  const swipe = useRef<{ x: number; y: number; t: number; dx: number; axis?: "x" | "y" }>(null);

  // With many projects the open one can sit below the fold of the list; bring it into view. Only when
  // the open page changes or the list first arrives: App replaces the array on every live update, and
  // that must not undo the user's own scrolling.
  const desktopSide = useRef<HTMLElement>(null);
  const loaded = p.projects.length > 0;
  useEffect(() => {
    desktopSide.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [p.activeKey, route.name, loaded]);

  const side = (inDrawer: boolean) => (
    <>
      <div className={s.top}>
        <a href="/" className={s.brand} aria-label={t("nav.home")} title={t("nav.home")}>
          <Logo className={s.logo} />
          <span className={s.name}>myboard</span>
          {boot.version && <span className={s.ver}>{boot.version}</span>}
        </a>
        <a
          className={s.repo}
          href="https://github.com/nessshon/myboard"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          title="GitHub"
        >
          <Icon name="github" size={18} />
        </a>
      </div>
      <nav className={s.nav}>
        <div className={s.group}>
          <div className={`caps ${s.label}`}>
            <span className={s.labelText}>{t(archive ? "nav.archive" : "nav.projects")}</span>
            {isAdmin && !archive && (
              <Button
                size="sm"
                className={s.add}
                icon="plus"
                aria-label={t("nav.newProject")}
                onClick={p.onNewProject}
              />
            )}
          </div>
          <div className={s.projects}>
            <ProjectList
              projects={shown}
              activeKey={p.activeKey}
              drag={archive ? undefined : inDrawer ? "handle" : wide ? "row" : undefined}
              onMove={move}
              onEdit={isAdmin ? setEditing : undefined}
            />
          </div>
          {hasArchive && (
            <button
              type="button"
              className={`${s.item} ${s.archive}`}
              title={t(archive ? "nav.allProjects" : "nav.showArchive")}
              onClick={() => setArchiveOpen(!archive)}
            >
              <span className={s.nico}>
                <Icon name={archive ? "chevronLeft" : "archive"} size={18} />
              </span>
              <span className={`ellipsis ${s.text}`}>
                {t(archive ? "nav.allProjects" : "nav.archive")}
              </span>
            </button>
          )}
        </div>
      </nav>
      <div className={s.account}>
        <div className={s.profile}>
          <Avatar name={personName(p.me)} src={p.me.avatar_url} size={28} />
          <div className={s.who}>
            <span className={s.whoName}>{personName(p.me)}</span>
            <span className={s.sub}>
              {p.me.username && `@${p.me.username}`}
              {isAdmin && `${p.me.username ? " · " : ""}${t("header.admin")}`}
            </span>
          </div>
        </div>
        {isAdmin && (
          <a
            className={s.item}
            href="/users"
            aria-current={route.name === "users" ? "page" : undefined}
            title={t("nav.users")}
          >
            <span className={s.nico}>
              <Icon name="users" size={18} />
            </span>
            <span className={`ellipsis ${s.text}`}>{t("nav.users")}</span>
          </a>
        )}
        <a
          className={s.item}
          href="/integrations"
          aria-current={route.name === "integrations" ? "page" : undefined}
          title={t("nav.integrations")}
        >
          <span className={s.nico}>
            <Icon name="blocks" size={18} />
          </span>
          <span className={`ellipsis ${s.text}`}>{t("nav.integrations")}</span>
        </a>
        <a
          href="/tasks"
          className={s.item}
          aria-current={route.name === "my" ? "page" : undefined}
          aria-label={myLabel}
          title={myLabel}
        >
          <span className={s.nico}>
            <Icon name="userCheck" size={18} />
          </span>
          <span className={`ellipsis ${s.text}`}>{t("nav.myTasks")}</span>
          {p.myCount > 0 && (
            <span className={`count ${s.badge}`} aria-hidden="true">
              {p.myCount}
            </span>
          )}
        </a>
        <button
          type="button"
          className={s.item}
          title={t("header.switchLang")}
          onClick={() => setLang(lang === "ru" ? "en" : "ru")}
        >
          <span className={s.nico}>
            <Icon name="globe" size={18} />
          </span>
          <span className={`ellipsis ${s.text}`}>{lang === "ru" ? "Русский" : "English"}</span>
        </button>
        <button
          type="button"
          className={`${s.item} ${s.out}`}
          title={t("header.logout")}
          onClick={() => setLeaving(true)}
        >
          <span className={s.nico}>
            <Icon name="logOut" size={18} />
          </span>
          <span className={`ellipsis ${s.text}`}>{t("header.logout")}</span>
        </button>
      </div>
    </>
  );

  return (
    <div className={s.shell}>
      <aside
        ref={desktopSide}
        className={`${s.side} ${wide ? s.wide : ""}`}
        aria-label={t("nav.label")}
      >
        {side(false)}
      </aside>
      <dialog
        ref={drawerRef}
        className={s.drawer}
        tabIndex={-1}
        aria-label={t("nav.label")}
        onClose={() => setDrawer(false)}
        onCancel={(e) => {
          e.preventDefault();
          setDrawer(false);
        }}
        onClick={(e) => e.target === e.currentTarget && setDrawer(false)}
        onTouchStart={(e) => {
          const p = e.touches[0];
          swipe.current = { x: p.clientX, y: p.clientY, t: e.timeStamp, dx: 0 };
        }}
        onTouchMove={(e) => {
          const sw = swipe.current;
          if (!sw) return;
          const dx = e.touches[0].clientX - sw.x;
          const dy = e.touches[0].clientY - sw.y;
          if (!sw.axis && Math.hypot(dx, dy) > 8) sw.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
          if (sw.axis !== "x") return;
          sw.dx = Math.min(0, dx);
          e.currentTarget.style.transition = "none";
          e.currentTarget.style.transform = `translateX(${sw.dx}px)`;
        }}
        onTouchCancel={(e) => {
          swipe.current = null;
          e.currentTarget.style.transition = "";
          e.currentTarget.style.transform = "";
        }}
        onTouchEnd={(e) => {
          const sw = swipe.current;
          swipe.current = null;
          if (sw?.axis !== "x") return;
          const d = e.currentTarget;
          d.style.transition = "";
          const flick = sw.dx < -30 && e.timeStamp - sw.t < 250;
          if (flick || sw.dx < -d.offsetWidth / 3) setDrawer(false);
          else d.style.transform = "";
        }}
      >
        <div className={`${s.side} ${s.wide}`}>{side(true)}</div>
      </dialog>

      {editing && <EditProjectDialog open project={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={leaving}
        title={t("header.logoutTitle")}
        confirm={t("header.logout")}
        variant="primary"
        onClose={() => setLeaving(false)}
        onConfirm={() => {
          logout();
          navigate("/login");
        }}
      />

      <div className={s.panel}>
        <header className={s.header}>
          <Button
            className={s.menu}
            icon="menu"
            aria-label={t("header.menu")}
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          />
          <Button
            className={s.toggle}
            icon={wide ? "panelLeftClose" : "panelLeftOpen"}
            aria-label={t(wide ? "header.collapse" : "header.expand")}
            onClick={toggle}
          />
          <span className={s.vsep} aria-hidden="true" />
          {typeof p.title === "string" ? (
            <h1 className={s.title}>{p.title}</h1>
          ) : (
            <div className={s.titleSlot}>{p.title}</div>
          )}
          {p.headerExtra}
          <ThemeSwitch />
        </header>
        <main className={s.main}>{p.children}</main>
      </div>
    </div>
  );
}
