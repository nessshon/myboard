import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
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

  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={className ? `${s.dialog} ${className}` : s.dialog}
      style={{ "--dialog-width": `${width}px` } as CSSProperties}
      aria-labelledby={titleId}
      // React passes a nested dialog's close up the component tree; only this dialog's own counts.
      onClose={(e) => e.target === e.currentTarget && onClose()}
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
