import { useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import s from "./Dialog.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  width?: number;
  className?: string;
  children: ReactNode;
};

export function Dialog({ open, onClose, title, width = 440, className, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // A text selection dragged out of a field ends on the backdrop and fires a click there too; only
  // a press that also started on the backdrop closes the window, or the typed text would be lost.
  const pressedOutside = useRef(false);
  const shown = useRef(open);

  // Before the content's own effects: a field one of them focuses (a new task's title) keeps the focus.
  useLayoutEffect(() => {
    const d = ref.current!;
    shown.current = open;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={className ? `${s.dialog} ${className}` : s.dialog}
      style={{ "--dialog-width": `${width}px` } as CSSProperties}
      aria-labelledby={titleId}
      // React passes a nested dialog's close up the component tree; only this dialog's own counts. A close the
      // owner made by `open` is already known to it.
      onClose={(e) => e.target === e.currentTarget && shown.current && onClose()}
      // Esc and Android's back gesture cancel a dialog; the owner closes it, so it can still ask about unsaved text.
      // Chrome lets a page hold back only a cancel the user acted before; any other just closes.
      onCancel={(e) => {
        if (e.target !== e.currentTarget || !e.cancelable) return;
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(e) => (pressedOutside.current = e.target === e.currentTarget)}
      onClick={(e) => e.target === e.currentTarget && pressedOutside.current && onClose()}
    >
      {open && (
        <div className={s.body}>
          <h2 id={titleId} className={s.title} tabIndex={-1} autoFocus>
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
