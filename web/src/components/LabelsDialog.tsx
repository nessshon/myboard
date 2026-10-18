import { useState } from "react";
import type { Label, Task } from "../api";
import { useT } from "../i18n";
import { LIMITS } from "../limits";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { PROJECT_COLORS } from "./ProjectBadge";
import { ConfirmDialog } from "./ProjectDialogs";
import { toast } from "./Toast";
import s from "./LabelsDialog.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  labels: Label[];
  tasks: Task[];
  onChange: (label: Label, data: Partial<Pick<Label, "name" | "color">>) => void;
  onDelete: (label: Label) => void;
};

export function LabelsDialog({ open, onClose, labels, tasks, onChange, onDelete }: Props) {
  const t = useT();
  const [painting, setPainting] = useState<string | null>(null);
  const [asking, setAsking] = useState<Label | null>(null);
  const uses = (label: Label) => tasks.filter((x) => x.labels.includes(label.id)).length;

  function rename(label: Label, input: HTMLInputElement) {
    const name = input.value.trim();
    if (name === label.name) return;
    const taken = labels.some(
      (l) => l.id !== label.id && l.name.toLowerCase() === name.toLowerCase(),
    );
    if (!name || taken) {
      if (taken) toast(t("label.exists", { name }));
      input.value = label.name;
      return;
    }
    onChange(label, { name });
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} title={t("label.title")} width={460}>
        <div className={s.rows}>
          {labels.map((l) => (
            <div key={l.id} className={s.row}>
              <div className={s.line}>
                <button
                  type="button"
                  className={s.color}
                  style={{ background: l.color }}
                  aria-label={t("label.color", { name: l.name })}
                  aria-expanded={painting === l.id}
                  onClick={() => setPainting(painting === l.id ? null : l.id)}
                />
                <input
                  key={l.name}
                  className={`input ${s.name}`}
                  defaultValue={l.name}
                  maxLength={LIMITS.labelName}
                  aria-label={t("label.name")}
                  onBlur={(e) => rename(l, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
                <span className="count">{t("label.tasks", { count: uses(l) })}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  className={s.del}
                  aria-label={t("label.delete", { name: l.name })}
                  title={t("label.delete", { name: l.name })}
                  onClick={() => setAsking(l)}
                />
              </div>
              {painting === l.id && (
                <div
                  className={s.swatches}
                  role="group"
                  aria-label={t("label.color", { name: l.name })}
                >
                  {PROJECT_COLORS.map((c, i) => (
                    <button
                      key={c}
                      type="button"
                      className={s.swatch}
                      style={{ background: c, color: c }}
                      aria-pressed={l.color === c}
                      aria-label={`${t("project.color")} ${i + 1}`}
                      onClick={() => {
                        setPainting(null);
                        if (c !== l.color) onChange(l, { color: c });
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className={s.foot}>
          <p className="hint">{t("label.hint")}</p>
          <Button onClick={onClose}>{t("common.done")}</Button>
        </div>
      </Dialog>
      {asking && (
        <ConfirmDialog
          open
          title={t("label.deleteTitle", { name: asking.name })}
          text={
            uses(asking) ? t("label.deleteText", { count: uses(asking) }) : t("label.deleteUnused")
          }
          confirm={t("common.delete")}
          onClose={() => setAsking(null)}
          onConfirm={() => {
            onDelete(asking);
            setAsking(null);
          }}
        />
      )}
    </>
  );
}
