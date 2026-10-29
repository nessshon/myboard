import type { KeyboardEvent, ReactNode } from "react";
import type { useAttach } from "./Files";
import s from "./Editor.module.css";

type Props = {
  head?: ReactNode;
  children: ReactNode;
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
  files,
  attach,
  counter,
  actions,
  onSubmit,
  onCancel,
  className,
}: Props) {
  // A key the mention list took is already handled.
  function keyDown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
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
      <div className={s.text} data-text>
        {children}
      </div>
      {files && <div className={s.files}>{files}</div>}
      {(attach || counter || actions) && (
        <div className={s.bar}>
          {attach?.button}
          <span className={s.gap} />
          {counter}
          {actions}
        </div>
      )}
    </div>
  );
}
