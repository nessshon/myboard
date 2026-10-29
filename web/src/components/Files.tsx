import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { drop, fileURL, uploadFile, type Attachment, type Setter } from "../api";
import { formatSize } from "../format";
import { useLang, useT } from "../i18n";
import { ATTACHMENT_EXTENSIONS, LIMITS } from "../limits";
import { Icon } from "./Icon";
import s from "./Files.module.css";

// A file on its way: picked in the comment field, refused there, being sent, or failed to send.
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

// The reason a file cannot go, or "" when it can.
export function refusal(file: File, t: ReturnType<typeof useT>) {
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

// One at a time: files land in the order they were picked, and a phone has one thin uplink anyway.
const PARALLEL = 1;

export function useUploads(setAttachments: Setter<Attachment>) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const running = useRef(0);
  const waiting = useRef<{ upload: Upload; done: (sent: boolean) => void }[]>([]);
  const change = (key: string, patch: Partial<Upload>) =>
    setUploads((us) => us.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  function next() {
    while (running.current < PARALLEL && waiting.current.length) {
      const { upload: u, done } = waiting.current.shift()!;
      running.current++;
      uploadFile({ task: u.task, comment: u.comment }, u.file, (share) => change(u.key, { share }))
        .then((row) => {
          setAttachments((rows) => rows && [...rows.filter((r) => r.id !== row.id), row]);
          setUploads((us) => us.filter((x) => x.key !== u.key));
          forget(u);
          done(true);
        })
        .catch(() => {
          change(u.key, { state: "failed", share: 0 });
          done(false);
        })
        .finally(() => {
          running.current--;
          next();
        });
    }
  }

  function enqueue(u: Upload) {
    return new Promise<boolean>((done) => {
      waiting.current.push({ upload: u, done });
      next();
    });
  }

  // Resolves to how many arrived.
  async function send(picked: Upload[], comment = "") {
    const batch = picked.map((u) => ({ ...u, comment, state: "sending" as const, share: 0 }));
    setUploads((us) => [...us, ...batch]);
    const sent = await Promise.all(batch.map(enqueue));
    return sent.filter(Boolean).length;
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
export function useFileEdit(
  setAttachments: Setter<Attachment>,
  me: string | undefined,
  fail: () => void,
) {
  const [before, setBefore] = useState(new Set<string>());
  const [hidden, setHidden] = useState<string[]>([]);
  const added = (items: Attachment[]) => items.filter((a) => !before.has(a.id) && a.author === me);
  return {
    begin(items: Attachment[]) {
      setBefore(new Set(items.map((a) => a.id)));
      setHidden([]);
    },
    shown: (items: Attachment[]) => items.filter((a) => !hidden.includes(a.id)),
    hide: (a: Attachment) => setHidden((h) => [...h, a.id]),
    save(items: Attachment[]) {
      items
        .filter((a) => hidden.includes(a.id))
        .forEach((a) => drop("attachments", setAttachments, a, fail));
      setHidden([]);
    },
    cancel(items: Attachment[]) {
      added(items).forEach((a) => drop("attachments", setAttachments, a, fail));
      setHidden([]);
    },
  };
}

// A field files can be dropped or pasted into, and its paperclip. Only files are taken: text dragged or
// pasted in stays the field's business.
export function useAttach(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const t = useT();
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
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
        onClick={() => onRemove?.(a)}
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
  const [long, setLong] = useState(false);
  const a = items[index];
  // Fixed while this file is shown, or each new token would load the original again.
  const src = useMemo(() => fileURL(a, token), [a.id]);
  const go = (step: number) => {
    setLong(false);
    onIndex((index + step + items.length) % items.length);
  };

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const arrow = (step: number, className: string) => (
    <button
      type="button"
      className={className}
      aria-label={t(step < 0 ? "file.previous" : "file.next")}
      onClick={() => go(step)}
    >
      <Icon name={step < 0 ? "chevronLeft" : "chevronRight"} size={22} />
    </button>
  );

  return (
    <dialog
      ref={ref}
      className={s.viewer}
      aria-label={a.name}
      // React passes this close up to the task window, which checks the target; nothing else to do here.
      onClose={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (items.length > 1 && e.key === "ArrowLeft") go(-1);
        if (items.length > 1 && e.key === "ArrowRight") go(1);
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
          onClick={() => ref.current?.close()}
        >
          <Icon name="x" size={20} />
        </button>
      </div>
      <div
        className={`${s.stage} ${long ? s.long : ""}`}
        onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      >
        {isVideo(a.name) ? (
          <video key={a.id} src={src} controls playsInline />
        ) : (
          <img
            key={a.id}
            src={src}
            alt={a.name}
            // A page-long screenshot cannot be read fitted to the screen, so it opens by width.
            onLoad={(e) =>
              setLong(e.currentTarget.naturalHeight > 2.5 * e.currentTarget.naturalWidth)
            }
          />
        )}
        {items.length > 1 && arrow(-1, `${s.nav} ${s.prev}`)}
        {items.length > 1 && arrow(1, `${s.nav} ${s.next}`)}
      </div>
      <div className={s.bottom}>
        {items.length > 1 && arrow(-1, s.tool)}
        {items.length > 1 && (
          <span>{t("file.position", { n: index + 1, total: items.length })}</span>
        )}
        {items.length > 1 && arrow(1, s.tool)}
      </div>
    </dialog>
  );
}
