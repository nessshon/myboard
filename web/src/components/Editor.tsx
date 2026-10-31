import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { User } from "../api";
import { useT } from "../i18n";
import type { useAttach } from "./Files";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import f from "./Files.module.css";
import s from "./Editor.module.css";

type Props = {
  head?: ReactNode;
  children: ReactNode;
  text: string;
  people?: User[];
  files?: ReactNode;
  attach?: ReturnType<typeof useAttach>;
  counter?: ReactNode;
  actions?: ReactNode;
  onSubmit: () => void;
  onCancel?: () => void;
  className?: string;
};

// The one frame text is written in: a task's title and description, a comment, a reply.
export function Editor({
  head,
  children,
  text,
  people,
  files,
  attach,
  counter,
  actions,
  onSubmit,
  onCancel,
  className,
}: Props) {
  const t = useT();
  const field = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState(false);
  const empty = !text.trim();
  // A sent comment empties the text: the next one starts written, not previewed.
  if (preview && empty) setPreview(false);

  // Going back focuses the field, which was only hidden, so its caret and undo are where they were.
  function toggle() {
    flushSync(() => setPreview(!preview));
    if (preview) field.current?.querySelector("textarea")?.focus();
  }

  // A key the mention list took is already handled.
  function keyDown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      // Sent from the preview, the field takes the keyboard back before the text is cleared.
      if (preview) toggle();
      onSubmit();
    }
    if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      data-editor
      {...attach?.zone}
      className={[s.frame, attach?.zone.className, className].filter(Boolean).join(" ")}
      onKeyDown={keyDown}
      onPaste={attach?.onPaste}
    >
      {head && <div className={s.head}>{head}</div>}
      <div ref={field} className={s.text} data-text hidden={preview}>
        {children}
      </div>
      {preview && (
        <div className={s.preview}>
          <Markdown text={text} people={people} />
        </div>
      )}
      {files && <div className={s.files}>{files}</div>}
      <div className={s.bar}>
        {attach?.button}
        <button
          type="button"
          className={f.clip}
          aria-label={t("common.preview")}
          title={t("common.preview")}
          aria-pressed={preview}
          data-preview
          disabled={empty}
          onClick={toggle}
        >
          <Icon name="eye" size={16} />
        </button>
        <span className={s.gap} />
        {counter}
        {actions}
      </div>
    </div>
  );
}
