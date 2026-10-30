import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { flushSync } from "react-dom";
import { drop, fileURL, put, uploadFile, type Attachment, type Setter } from "../api";
import { formatSize } from "../format";
import { useLang, useT } from "../i18n";
import { ATTACHMENT_EXTENSIONS, LIMITS } from "../limits";
import { Icon } from "./Icon";
import s from "./Files.module.css";

export type Upload = {
  key: string;
  file: File;
  task: string;
  comment: string;
  state: "picked" | "refused" | "sending" | "failed";
  share: number;
  reason?: string;
  preview?: string;
};

const extension = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
// PocketBase makes thumbs of these only and serves the original for anything else (apis/file.go).
const isImage = (name: string) => ["png", "jpg", "jpeg", "gif", "webp"].includes(extension(name));
const isVideo = (name: string) => ["mp4", "mov", "webm"].includes(extension(name));

let lastKey = 0;

function refusal(file: File, t: ReturnType<typeof useT>) {
  if (file.size > LIMITS.attachmentSize)
    return t("file.tooBig", { size: LIMITS.attachmentSize / 1024 / 1024 });
  if (!ATTACHMENT_EXTENSIONS.includes(extension(file.name))) return t("file.badType");
  return "";
}

export function pick(files: File[], task: string, t: ReturnType<typeof useT>): Upload[] {
  return files.map((file) => {
    const reason = refusal(file, t);
    return {
      key: String(++lastKey),
      file,
      task,
      comment: "",
      state: reason ? "refused" : "picked",
      share: 0,
      reason,
      preview: !reason && isImage(file.name) ? URL.createObjectURL(file) : undefined,
    };
  });
}

export const forget = (u: Upload) => u.preview && URL.revokeObjectURL(u.preview);

export function unpick(uploads: Upload[], key: string) {
  uploads.filter((u) => u.key === key).forEach(forget);
  return uploads.filter((u) => u.key !== key);
}

// One at a time: files land in the order they were picked, and a phone has one thin uplink anyway.
const PARALLEL = 1;

export function useUploads(setAttachments: Setter<Attachment>) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const running = useRef(0);
  const waiting = useRef<{ upload: Upload; done: (row?: Attachment) => void }[]>([]);
  const change = (key: string, patch: Partial<Upload>) =>
    setUploads((us) => us.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  function next() {
    while (running.current < PARALLEL && waiting.current.length) {
      const { upload: u, done } = waiting.current.shift()!;
      running.current++;
      uploadFile({ task: u.task, comment: u.comment }, u.file, (share) => change(u.key, { share }))
        .then((row) => {
          put(setAttachments, row);
          setUploads((us) => us.filter((x) => x.key !== u.key));
          forget(u);
          done(row);
        })
        .catch(() => {
          change(u.key, { state: "failed", share: 0 });
          done();
        })
        .finally(() => {
          running.current--;
          next();
        });
    }
  }

  function enqueue(u: Upload) {
    return new Promise<Attachment | undefined>((done) => {
      waiting.current.push({ upload: u, done });
      next();
    });
  }

  // Resolves to the rows that arrived.
  async function send(picked: Upload[], comment = "") {
    const batch = picked.map((u) => ({ ...u, comment, state: "sending" as const, share: 0 }));
    setUploads((us) => [...us, ...batch]);
    const sent = await Promise.all(batch.map(enqueue));
    return sent.filter((a) => a !== undefined);
  }

  function retry(key: string) {
    const u = uploads.find((x) => x.key === key);
    if (!u) return;
    change(key, { state: "sending", share: 0 });
    enqueue(u);
  }

  function dismiss(key: string) {
    const u = uploads.find((x) => x.key === key);
    if (u) forget(u);
    setUploads((us) => us.filter((x) => x.key !== key));
  }

  // Gone with the comment that failed to get any of them.
  function dropAll(keys: string[]) {
    setUploads((us) => {
      us.filter((u) => keys.includes(u.key)).forEach(forget);
      return us.filter((u) => !keys.includes(u.key));
    });
  }

  return { uploads, send, retry, dismiss, dropAll };
}

// Files changed together with the text around them. A file added while editing is kept at once, so
// others may see it before Save, and Cancel deletes it again; a removed one is only hidden until Save.
export function useFileEdit(setAttachments: Setter<Attachment>, fail: () => void) {
  const [added, setAdded] = useState<Attachment[]>([]);
  const [hidden, setHidden] = useState<Attachment[]>([]);
  const [waiting, setWaiting] = useState(0);
  // Each edit is a round; a file that lands after its round ended was cancelled with it.
  const round = useRef(0);
  const remove = (rows: Attachment[]) =>
    rows.forEach((a) => drop("attachments", setAttachments, a, fail));
  function next() {
    round.current++;
    setAdded([]);
    setHidden([]);
  }
  return {
    begin: next,
    track(sent: Promise<Attachment[]>) {
      const mine = round.current;
      setWaiting((n) => n + 1);
      sent.then((rows) => {
        setWaiting((n) => n - 1);
        if (mine === round.current) setAdded((a) => [...a, ...rows]);
        else remove(rows);
      });
    },
    shown: (items: Attachment[]) => items.filter((a) => !hidden.some((h) => h.id === a.id)),
    hide: (a: Attachment) => setHidden((h) => [...h, a]),
    changed: added.length > 0 || hidden.length > 0 || waiting > 0,
    save() {
      remove(hidden);
      next();
    },
    cancel() {
      remove(added);
      next();
    },
  };
}

// A picture dragged within this page comes along as a file too (Chrome, Safari), and dropped back it
// would be uploaded again; only files from outside the page are new.
let draggingHere = false;
addEventListener("dragstart", () => (draggingHere = true));
addEventListener("dragend", () => (draggingHere = false));

// A field files can be dropped or pasted into, and its paperclip. Only files are taken: text dragged or
// pasted in stays the field's business.
export function useAttach(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const t = useT();
  const hasFiles = (e: DragEvent) => !draggingHere && e.dataTransfer.types.includes("Files");
  return {
    zone: {
      className: `${s.attachable} ${over ? s.over : ""}`,
      onDragOver: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        setOver(false);
        if (!hasFiles(e)) return;
        e.preventDefault();
        onFiles([...e.dataTransfer.files]);
      },
    },
    onPaste: (e: ClipboardEvent) => {
      if (!e.clipboardData.files.length) return;
      e.preventDefault();
      onFiles([...e.clipboardData.files]);
    },
    button: (
      <>
        <button
          type="button"
          className={s.clip}
          aria-label={t("file.attach")}
          title={t("file.attach")}
          onClick={() => input.current?.click()}
        >
          <Icon name="paperclip" size={16} />
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={ATTACHMENT_EXTENSIONS.map((x) => `.${x}`).join(",")}
          onChange={(e) => {
            onFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </>
    ),
  };
}

type Props = {
  items: Attachment[];
  uploads?: Upload[];
  token: string;
  canRemove?: (a: Attachment) => boolean;
  onRemove?: (a: Attachment) => void;
  onRetry?: (key: string) => void;
  onDismiss?: (key: string) => void;
};

export function Files({
  items,
  uploads = [],
  token,
  canRemove,
  onRemove,
  onRetry,
  onDismiss,
}: Props) {
  const t = useT();
  const lang = useLang();
  const [viewing, setViewing] = useState<number | null>(null);
  // A thumb keeps the link it was first loaded by: a new token would make the browser fetch it again.
  const thumbs = useRef(new Map<string, string>());
  const thumbOf = (a: Attachment) => {
    if (!thumbs.current.has(a.id) && token)
      thumbs.current.set(a.id, fileURL(a, token, "&thumb=0x192"));
    return thumbs.current.get(a.id);
  };
  const [, redraw] = useState(0);
  // A picture taller than 3:4 is shown cut from the top; its own thumb is cut so too and stays sharp.
  const tall = (a: Attachment, img: HTMLImageElement) => {
    if (img.naturalWidth >= 0.75 * img.naturalHeight || !token) return;
    if (thumbs.current.get(a.id)?.includes("144x192t")) return;
    thumbs.current.set(a.id, fileURL(a, token, "&thumb=144x192t"));
    redraw((n) => n + 1);
  };
  const viewable = items.filter((a) => isImage(a.name) || isVideo(a.name));
  const pictures = items.filter((a) => isImage(a.name));
  const others = items.filter((a) => !isImage(a.name));
  const localPictures = uploads.filter((u) => u.preview);
  const localOthers = uploads.filter((u) => !u.preview);
  if (!items.length && !uploads.length) return null;

  const remove = (a: Attachment) =>
    canRemove?.(a) && (
      <button
        type="button"
        className={s.remove}
        aria-label={t("file.delete")}
        title={t("file.delete")}
        onClick={(e) => {
          // The button goes with the file; the keyboard stays in the editor it was in.
          e.currentTarget
            .closest("[data-editor]")
            ?.querySelector<HTMLElement>("[data-text] textarea")
            ?.focus();
          onRemove?.(a);
        }}
      >
        <Icon name="x" size={13} />
      </button>
    );
  const dismiss = (u: Upload) =>
    u.state !== "sending" && (
      <button
        type="button"
        className={s.remove}
        aria-label={t("common.remove")}
        title={t("common.remove")}
        onClick={() => onDismiss?.(u.key)}
      >
        <Icon name="x" size={13} />
      </button>
    );

  return (
    <div className={s.files}>
      {(pictures.length > 0 || localPictures.length > 0) && (
        <div className={s.thumbs}>
          {pictures.map((a) => (
            <span key={a.id} className={s.thumb}>
              <button
                type="button"
                className={s.open}
                title={a.name}
                onClick={() => setViewing(viewable.indexOf(a))}
              >
                {thumbOf(a) ? (
                  <img src={thumbOf(a)} alt={a.name} onLoad={(e) => tall(a, e.currentTarget)} />
                ) : (
                  <span className={s.blank} />
                )}
              </button>
              {remove(a)}
            </span>
          ))}
          {localPictures.map((u) => (
            <span
              key={u.key}
              className={`${s.thumb} ${u.state === "sending" ? s.sending : ""} ${u.state === "failed" ? s.failed : ""}`}
              title={u.file.name}
            >
              <img src={u.preview} alt={u.file.name} />
              {u.state === "sending" && (
                <>
                  <span className={s.share}>{Math.round(u.share * 100)}&nbsp;%</span>
                  <span className={s.bar} style={{ width: `${u.share * 100}%` }} />
                </>
              )}
              {u.state === "failed" && (
                <button
                  type="button"
                  className={s.retry}
                  aria-label={t("file.retry")}
                  title={t("file.retry")}
                  onClick={() => onRetry?.(u.key)}
                >
                  <Icon name="rotateCcw" size={15} />
                </button>
              )}
              {dismiss(u)}
            </span>
          ))}
        </div>
      )}
      {(others.length > 0 || localOthers.length > 0) && (
        <div className={s.chips}>
          {others.map((a) => {
            const label = (
              <>
                <Icon name={isVideo(a.name) ? "film" : "fileText"} size={14} />
                <Name name={a.name} />
                <span className={s.size}>{formatSize(a.size, lang)}</span>
              </>
            );
            return (
              <span key={a.id} className={s.chip}>
                {isVideo(a.name) ? (
                  <button
                    type="button"
                    className={s.label}
                    title={a.name}
                    onClick={() => setViewing(viewable.indexOf(a))}
                  >
                    {label}
                  </button>
                ) : (
                  <a
                    className={s.label}
                    title={a.name}
                    href={fileURL(a, token, extension(a.name) === "pdf" ? "" : "&download=1")}
                    target={extension(a.name) === "pdf" ? "_blank" : undefined}
                    rel="noopener"
                  >
                    {label}
                  </a>
                )}
                {remove(a)}
              </span>
            );
          })}
          {localOthers.map((u) => (
            <span
              key={u.key}
              className={`${s.chip} ${u.state === "refused" || u.state === "failed" ? s.bad : ""}`}
              style={
                u.state === "sending"
                  ? {
                      background: `linear-gradient(to right, var(--accent-soft) ${u.share * 100}%, var(--hover) ${u.share * 100}%)`,
                    }
                  : undefined
              }
            >
              <span className={s.label} title={u.file.name}>
                <Icon name={isVideo(u.file.name) ? "film" : "fileText"} size={14} />
                <Name name={u.file.name} />
                <span className={s.size}>
                  {u.state === "sending"
                    ? `${Math.round(u.share * 100)} %`
                    : u.reason ||
                      (u.state === "failed" ? t("file.notSent") : formatSize(u.file.size, lang))}
                </span>
              </span>
              {u.state === "failed" && (
                <button type="button" className={s.again} onClick={() => onRetry?.(u.key)}>
                  {t("file.retry")}
                </button>
              )}
              {dismiss(u)}
            </span>
          ))}
        </div>
      )}
      {viewing !== null && viewable[viewing] && (
        <Viewer
          items={viewable}
          index={viewing}
          token={token}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

// The extension stays in sight when a long name is cut.
function Name({ name }: { name: string }) {
  const dot = name.lastIndexOf(".");
  return (
    <span className={s.name}>
      <span className={s.base}>{dot > 0 ? name.slice(0, dot) : name}</span>
      {dot > 0 && <span className={s.ext}>{name.slice(dot)}</span>}
    </span>
  );
}

function Viewer({
  items,
  index,
  token,
  onIndex,
  onClose,
}: {
  items: Attachment[];
  index: number;
  token: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const ref = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; t: number; dx: number; axis?: "x" | "y" }>(null);
  const a = items[index];
  const many = items.length > 1;
  const at = (step: number) => items[(index + step + items.length) % items.length];
  const close = () => ref.current?.close();
  // The list is live: by the end of a slide a file may have come or gone.
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
  });

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // The strip finishes the move (or springs back) and the shown file changes in that same frame, so the
  // file just left never flashes back in the middle.
  function settle(step: number) {
    const el = track.current!;
    const to = at(step).id;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const anim = el.animate(
      [
        { transform: getComputedStyle(el).transform },
        { transform: `translateX(${-100 - step * 100}%)` },
      ],
      { duration: reduce ? 0 : 200, easing: "ease", fill: "forwards" },
    );
    anim.onfinish = () => {
      el.style.transform = "";
      const i = latest.current.findIndex((x) => x.id === to);
      // Closed during the slide, the viewer must not come back on the next file.
      if (step && i >= 0 && ref.current?.open) flushSync(() => onIndex(i));
      anim.cancel();
      // Focus on a video that just went inert drops to the page, and the arrow keys with it.
      if (ref.current?.open && !ref.current.contains(document.activeElement)) ref.current.focus();
    };
  }

  // A press mid-slide would start the next one from the middle of the strip.
  const move = (step: number) => {
    if (!track.current!.getAnimations().length) settle(step);
  };

  const arrow = (step: number, className: string) => (
    <button
      type="button"
      className={className}
      aria-label={t(step < 0 ? "file.previous" : "file.next")}
      onClick={() => move(step)}
    >
      <Icon name={step < 0 ? "chevronLeft" : "chevronRight"} size={22} />
    </button>
  );

  return (
    <dialog
      ref={ref}
      className={s.viewer}
      tabIndex={-1}
      aria-label={a.name}
      onClose={onClose}
      onKeyDown={(e) => {
        // Its keys are its own: Esc here closes the viewer, not the edit it was opened from.
        e.stopPropagation();
        if (many && e.key === "ArrowLeft") move(-1);
        if (many && e.key === "ArrowRight") move(1);
      }}
    >
      <div className={s.top}>
        <span className={s.title}>
          <b>{a.name}</b>
          <span>{formatSize(a.size, lang)}</span>
        </span>
        <a
          className={s.tool}
          href={fileURL(a, token)}
          target="_blank"
          rel="noopener"
          aria-label={t("file.open")}
          title={t("file.open")}
        >
          <Icon name="externalLink" size={18} />
        </a>
        <a
          className={s.tool}
          href={fileURL(a, token, "&download=1")}
          aria-label={t("file.download")}
          title={t("file.download")}
        >
          <Icon name="download" size={18} />
        </a>
        <button
          type="button"
          className={s.tool}
          aria-label={t("common.close")}
          title={t("common.close")}
          autoFocus
          onClick={close}
        >
          <Icon name="x" size={20} />
        </button>
      </div>
      <div className={s.stage}>
        {/* The same swipe as the side menu's (AppShell), so the app has one gesture. */}
        <div
          ref={track}
          className={many ? `${s.track} ${s.many}` : s.track}
          onTouchStart={(e) => {
            const p = e.touches[0];
            if (swipe.current?.axis === "x") settle(0);
            swipe.current = null;
            // Two fingers zoom, a zoomed page pans, and on a video the finger is for its scrubber.
            if (!many || e.touches.length > 1 || (visualViewport?.scale ?? 1) > 1) return;
            if (e.target instanceof HTMLVideoElement || track.current!.getAnimations().length)
              return;
            swipe.current = { x: p.clientX, y: p.clientY, t: e.timeStamp, dx: 0 };
          }}
          onTouchMove={(e) => {
            const sw = swipe.current;
            if (!sw) return;
            const dx = e.touches[0].clientX - sw.x;
            const dy = e.touches[0].clientY - sw.y;
            if (!sw.axis && Math.hypot(dx, dy) > 8)
              sw.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            if (sw.axis !== "x") return;
            sw.dx = dx;
            e.currentTarget.style.transform = `translateX(calc(-100% + ${dx}px))`;
          }}
          onTouchCancel={() => {
            if (swipe.current?.axis === "x") settle(0);
            swipe.current = null;
          }}
          onTouchEnd={(e) => {
            const sw = swipe.current;
            swipe.current = null;
            if (sw?.axis !== "x") return;
            const flick = Math.abs(sw.dx) > 30 && e.timeStamp - sw.t < 250;
            const far = Math.abs(sw.dx) > e.currentTarget.offsetWidth / 3;
            settle(flick || far ? -Math.sign(sw.dx) : 0);
          }}
        >
          {/* Two files: the one neighbour sits on both sides, the left copy under its own key. */}
          {many && (
            <Slide
              key={items.length === 2 ? `${at(-1).id}-left` : at(-1).id}
              a={at(-1)}
              token={token}
              onClose={close}
            />
          )}
          <Slide key={a.id} a={a} token={token} current onClose={close} />
          {many && <Slide key={at(1).id} a={at(1)} token={token} onClose={close} />}
        </div>
        {many && arrow(-1, `${s.nav} ${s.prev}`)}
        {many && arrow(1, `${s.nav} ${s.next}`)}
      </div>
      <div className={s.bottom}>
        {many && arrow(-1, s.tool)}
        {many && <span>{t("file.position", { n: index + 1, total: items.length })}</span>}
        {many && arrow(1, s.tool)}
      </div>
    </dialog>
  );
}

function Slide({
  a,
  token,
  current = false,
  onClose,
}: {
  a: Attachment;
  token: string;
  current?: boolean;
  onClose: () => void;
}) {
  const [long, setLong] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  // Fixed while this file is shown, or each new token would load the original again.
  const src = useMemo(() => fileURL(a, token), [a.id]);

  useEffect(() => {
    if (!current) video.current?.pause();
  }, [current]);

  return (
    <div
      className={`${s.slide} ${long ? s.long : ""}`}
      inert={!current}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {isVideo(a.name) ? (
        <video ref={video} src={src} controls playsInline />
      ) : (
        <img
          src={src}
          alt={a.name}
          // A page-long screenshot cannot be read fitted to the screen, so it opens by width.
          onLoad={(e) =>
            setLong(e.currentTarget.naturalHeight > 2.5 * e.currentTarget.naturalWidth)
          }
        />
      )}
    </div>
  );
}
