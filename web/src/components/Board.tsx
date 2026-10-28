import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS, getEventCoordinates } from "@dnd-kit/utilities";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  STATUSES,
  isClosed,
  type Label,
  type Status,
  type Task,
  type User,
  personName,
} from "../api";
import { formatDate, formatDue, isOverdue } from "../format";
import { useLang, useT } from "../i18n";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import s from "./Board.module.css";

export function useDragSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: {
        start: [KeyboardCode.Space],
        cancel: [KeyboardCode.Esc],
        end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
      },
    }),
  );
}

type Activator = { ref: (el: HTMLElement | null) => void; "aria-describedby": string };

export function StatusDot({ status }: { status: Status }) {
  return <span className={`${s.dot} ${s[status]}`} aria-hidden="true" />;
}

const isStatus = (id: UniqueIdentifier): id is Status => STATUSES.includes(id as Status);

type CardData = {
  projectKey: string;
  labels: Label[];
  people: User[];
  commentCount: Map<string, number>;
};

function CardBody({
  task,
  projectKey,
  labels,
  people,
  commentCount,
  handle,
  activator,
}: CardData & { task: Task; handle?: ReactNode; activator?: Activator }) {
  const t = useT();
  const lang = useLang();
  const who = task.assignees.flatMap((id) => people.filter((p) => p.id === id));
  const tags = labels.filter((l) => task.labels.includes(l.id));
  const href = `/p/${projectKey.toLowerCase()}/${task.number}`;
  // On a closed card the closing date replaces the due date, which no longer matters there.
  const closed = isClosed(task.status) && task.closed;
  return (
    <>
      {task.priority !== "normal" && (
        <span className="sr">
          {t("task.priority")}: {t(`priority.${task.priority}`)}
        </span>
      )}
      <div className={s.top}>
        <span className={s.key}>
          {projectKey}-{task.number}
        </span>
        {who.length > 0 && (
          <a
            className={s.who}
            href={href}
            title={who.map((p) => personName(p, t("users.gone"))).join(", ")}
            tabIndex={-1}
            aria-hidden="true"
            draggable={false}
          >
            {who.slice(0, 3).map((p) => (
              <Avatar key={p.id} name={personName(p)} src={p.avatar_url} size={20} />
            ))}
            {who.length > 3 && <span className={s.extra}>+{who.length - 3}</span>}
          </a>
        )}
        {handle}
      </div>
      <a className={`stretch ${s.open}`} href={href} draggable={false} {...activator}>
        {task.title}
      </a>
      {(tags.length > 0 || task.due || closed || commentCount.has(task.id)) && (
        <div className={s.meta}>
          {tags.map((l) => (
            <span key={l.id} className="tag">
              <span className="dot" style={{ background: l.color }} />
              <span className="ellipsis">{l.name}</span>
            </span>
          ))}
          {closed ? (
            <span
              className={task.status === "done" ? `${s.due} ${s.finished}` : s.due}
              title={t(task.status === "done" ? "task.closed.done" : "task.closed.cancelled")}
            >
              <Icon name="check" size={12} />
              {formatDate(task.closed, lang)}
            </span>
          ) : (
            task.due && (
              <span
                className={
                  isOverdue(task.due) && !isClosed(task.status) ? `${s.due} ${s.late}` : s.due
                }
              >
                <Icon name="calendar" size={12} />
                {formatDue(task.due, lang)}
              </span>
            )
          )}
          {commentCount.has(task.id) && (
            <span className={s.comments} title={t("comment.title")}>
              <Icon name="message" size={12} />
              {commentCount.get(task.id)}
            </span>
          )}
        </div>
      )}
    </>
  );
}

function SortableCard(props: CardData & { task: Task }) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.task.id });
  const cls = [s.card, s[props.task.priority], isDragging && s.ghost].filter(Boolean).join(" ");
  return (
    <div
      ref={setNodeRef}
      className={cls}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
    >
      <CardBody
        {...props}
        activator={{
          ref: setActivatorNodeRef,
          "aria-describedby": attributes["aria-describedby"],
        }}
      />
    </div>
  );
}

function Column({
  status,
  count,
  over,
  children,
}: {
  status: Status;
  count: number;
  over: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={over ? `${s.col} ${s.over}` : s.col}
      aria-label={t(`status.${status}`)}
    >
      <h3 className={s.colHead}>
        <StatusDot status={status} />
        <span className="ellipsis">{t(`status.${status}`)}</span>
        <span className={s.count}>{count}</span>
      </h3>
      {children}
    </section>
  );
}

const boardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length === 0) return closestCorners(args);
  const cards = hits.filter((h) => !isStatus(h.id));
  return cards.length ? cards : hits;
};

type BoardProps = CardData & {
  tasks: Task[];
  onMove: (id: string, status: Status, index: number) => void;
};

type Columns = Record<Status, string[]>;

const columnsOf = (tasks: Task[]) =>
  Object.fromEntries(
    STATUSES.map((st) => [st, tasks.filter((x) => x.status === st).map((x) => x.id)]),
  ) as Columns;

function useLiveColumns(tasks: Task[], onMove: BoardProps["onMove"]) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Columns | null>(null);

  const cols = drag ?? columnsOf(tasks);
  const byId = new Map(tasks.map((x) => [x.id, x]));
  const active = activeId ? byId.get(activeId) : undefined;
  const columnOf = (id: UniqueIdentifier) =>
    isStatus(id) ? id : STATUSES.find((st) => cols[st].includes(id as string));

  function hover({ active, over }: DragOverEvent) {
    const from = columnOf(active.id);
    const to = over && columnOf(over.id);
    if (!from || !to || from === to) return;
    const target = cols[to];
    let index = isStatus(over.id) ? target.length : target.indexOf(over.id as string);
    const rect = active.rect.current.translated;
    if (!isStatus(over.id) && rect && rect.top > over.rect.top + over.rect.height / 2) index++;
    setDrag({
      ...cols,
      [from]: cols[from].filter((id) => id !== active.id),
      [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)],
    });
  }

  function end({ active, over }: DragEndEvent) {
    const task = byId.get(String(active.id));
    const to = columnOf(active.id);
    setActiveId(null);
    setDrag(null);
    if (!task || !over || !to) return;
    let column = cols[to];
    if (!isStatus(over.id) && column.includes(over.id as string)) {
      column = arrayMove(column, column.indexOf(task.id), column.indexOf(over.id as string));
    }
    const index = column.indexOf(task.id);
    if (to === task.status && index === tasks.filter((x) => x.status === to).indexOf(task)) return;
    // A closed column is ordered by the closing date, so a manual order there would not hold.
    if (to === task.status && isClosed(to)) return;
    onMove(task.id, to, index);
  }

  const handlers = {
    onDragStart: (e: DragStartEvent) => {
      setActiveId(String(e.active.id));
      setDrag(columnsOf(tasks));
    },
    onDragOver: hover,
    onDragEnd: end,
    onDragCancel: () => {
      setActiveId(null);
      setDrag(null);
    },
  };
  return { cols, byId, active, handlers };
}

export function Board({ tasks, onMove, ...data }: BoardProps) {
  const t = useT();
  const sensors = useDragSensors();
  const { cols, byId, active, handlers } = useLiveColumns(tasks, onMove);

  return (
    <DndContext sensors={sensors} collisionDetection={boardCollision} {...handlers}>
      <div className={s.board}>
        {STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            count={cols[status].length}
            over={!!active && active.status !== status && cols[status].includes(active.id)}
          >
            <SortableContext items={cols[status]} strategy={verticalListSortingStrategy}>
              {cols[status].map((id) => {
                const x = byId.get(id);
                return x && <SortableCard key={id} task={x} {...data} />;
              })}
            </SortableContext>
            {cols[status].length === 0 && <span className={s.empty}>{t("task.columnEmpty")}</span>}
          </Column>
        ))}
      </div>
      <DragOverlay>
        {active && (
          <div className={`${s.card} ${s[active.priority]} ${s.lift}`}>
            <CardBody task={active} {...data} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function MobileColumn({
  status,
  count,
  over,
  current,
  onFocus,
  children,
}: {
  status: Status;
  count: number;
  over: boolean;
  current: boolean;
  onFocus: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={[s.mcol, over && s.over, !current && s.side].filter(Boolean).join(" ")}
      aria-label={t(`status.${status}`)}
      onClickCapture={(e) => {
        if (current) return;
        e.preventDefault();
        e.stopPropagation();
        onFocus();
      }}
    >
      <h3 className={s.mhead}>
        <StatusDot status={status} />
        <span className="ellipsis">{t(`status.${status}`)}</span>
        <span className={s.count}>{count}</span>
      </h3>
      {children}
    </section>
  );
}

function HandleCard(props: CardData & { task: Task }) {
  const t = useT();
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.task.id });
  return (
    <div
      ref={setNodeRef}
      className={[s.card, s.mcard, s[props.task.priority], isDragging && s.ghost]
        .filter(Boolean)
        .join(" ")}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <CardBody
        {...props}
        handle={
          <button
            ref={setActivatorNodeRef}
            type="button"
            className={`handle ${s.handle}`}
            {...attributes}
            {...listeners}
            aria-label={t("task.dragHandle")}
            title={t("task.dragHandle")}
          >
            <Icon name="grip" size={18} />
          </button>
        }
      />
    </div>
  );
}

const FIRST = STATUSES.indexOf("in_progress");
const EDGE = 24;
const TURN_MS = 450;

const stepOf = (lane: HTMLElement) =>
  (lane.children[1] as HTMLElement).offsetLeft - (lane.children[0] as HTMLElement).offsetLeft;

export function MobileBoard({ tasks, onMove, ...data }: BoardProps) {
  const t = useT();
  const sensors = useDragSensors();
  const { cols, byId, active, handlers } = useLiveColumns(tasks, onMove);
  const lane = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(FIRST);
  const turn = useRef({ dir: 0, timer: 0, scroll0: 0 });
  useEffect(() => stopTurn, []);

  useLayoutEffect(() => {
    if (lane.current) lane.current.scrollLeft = FIRST * stepOf(lane.current);
  }, []);

  const go = (i: number) => {
    const el = lane.current;
    const k = Math.max(0, Math.min(STATUSES.length - 1, i));
    el?.scrollTo({ left: k * stepOf(el), behavior: "smooth" });
  };

  function stopTurn() {
    clearTimeout(turn.current.timer);
    turn.current.dir = 0;
  }

  function move({ activatorEvent, delta }: DragMoveEvent) {
    const el = lane.current;
    const from = getEventCoordinates(activatorEvent);
    if (!el || !from) return;
    // dnd-kit's delta already counts how far the lane has scrolled since the drag began; take that
    // back out to get where the finger is on screen.
    const x = from.x + delta.x - (el.scrollLeft - turn.current.scroll0);
    const dir = x < EDGE ? -1 : x > el.clientWidth - EDGE ? 1 : 0;
    if (dir === turn.current.dir) return;
    stopTurn();
    if (!dir) return;
    turn.current.dir = dir;
    turn.current.timer = window.setTimeout(
      () => go(Math.round(el.scrollLeft / stepOf(el)) + dir),
      TURN_MS,
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollision}
      // The lane snaps to whole columns, which dnd-kit's step-by-step scrolling fights; `move` turns
      // it a column at a time instead. The page still scrolls up and down on its own.
      autoScroll={{ canScroll: (el) => el !== lane.current }}
      onDragStart={(e) => {
        turn.current.scroll0 = lane.current?.scrollLeft ?? 0;
        handlers.onDragStart(e);
      }}
      onDragMove={move}
      onDragOver={handlers.onDragOver}
      onDragEnd={(e) => {
        stopTurn();
        handlers.onDragEnd(e);
      }}
      onDragCancel={() => {
        stopTurn();
        handlers.onDragCancel();
      }}
    >
      <div className={s.mboard}>
        <div
          ref={lane}
          className={s.lane}
          onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / stepOf(e.currentTarget)))}
        >
          {STATUSES.map((status, i) => (
            <MobileColumn
              key={status}
              status={status}
              count={cols[status].length}
              over={!!active && active.status !== status && cols[status].includes(active.id)}
              current={i === at}
              onFocus={() => go(i)}
            >
              <div className={s.list}>
                <SortableContext items={cols[status]} strategy={verticalListSortingStrategy}>
                  {cols[status].map((id) => {
                    const x = byId.get(id);
                    return x && <HandleCard key={id} task={x} {...data} />;
                  })}
                </SortableContext>
                {cols[status].length === 0 && (
                  <span className={s.empty}>{t("task.columnEmpty")}</span>
                )}
              </div>
            </MobileColumn>
          ))}
        </div>
      </div>
      <DragOverlay>
        {active && (
          <div className={`${s.card} ${s.mcard} ${s[active.priority]} ${s.lift}`}>
            <CardBody
              task={active}
              {...data}
              handle={
                <span className={`handle ${s.handle}`} aria-hidden="true">
                  <Icon name="grip" size={18} />
                </span>
              }
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
