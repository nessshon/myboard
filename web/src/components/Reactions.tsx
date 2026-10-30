import { useEffect, useId, useRef, useState } from "react";
import { REACTIONS, personName, type Reaction, type ReactionKey, type User } from "../api";
import { useT } from "../i18n";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Menu } from "./Menu";
import s from "./Reactions.module.css";

const KEYS = Object.keys(REACTIONS) as ReactionKey[];

type Props = {
  reactions: Reaction[];
  people: User[];
  me: string;
  onToggle: (emoji: ReactionKey) => void;
};

export function Reactions({ reactions, people, me, onToggle }: Props) {
  const t = useT();
  const mine = (key: ReactionKey) => reactions.some((r) => r.emoji === key && r.author === me);
  const name = (id: string) => {
    const person = people.find((p) => p.id === id);
    return person ? personName(person, t("users.gone")) : "—";
  };
  const tipId = useId();
  // A phone has no hover: a long press shows who reacted, the next touch anywhere hides it, and the press does not
  // count as a tap on the reaction.
  const [held, setHeld] = useState<ReactionKey | null>(null);
  const press = useRef<{ timer?: ReturnType<typeof setTimeout>; held: boolean }>({ held: false });
  useEffect(() => {
    if (!held) return;
    const hide = () => setHeld(null);
    const later = setTimeout(() => document.addEventListener("touchstart", hide, { once: true }));
    return () => {
      clearTimeout(later);
      document.removeEventListener("touchstart", hide);
    };
  }, [held]);
  const release = () => clearTimeout(press.current.timer);
  // The names move left just enough for the widest they can be (the .tip max-width) to stay 8px off the right edge.
  const side = (e: { currentTarget: HTMLElement }) => {
    const widest = Math.min(240, innerWidth - 16);
    const left = e.currentTarget.getBoundingClientRect().left;
    e.currentTarget.style.setProperty(
      "--shift",
      `${Math.min(0, innerWidth - 8 - widest - left)}px`,
    );
  };
  return (
    <div className={s.row}>
      {/* First, as on GitHub: opened from the row start, the menu fits a phone screen. */}
      <Menu
        label={t("reaction.add")}
        triggerClass={s.add}
        align="left"
        trigger={<Icon name="smilePlus" size={16} />}
      >
        <div className={s.picker}>
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              className={`${s.pick} ${mine(key) ? s.mine : ""}`}
              onClick={() => onToggle(key)}
            >
              {REACTIONS[key]}
            </button>
          ))}
        </div>
      </Menu>
      {KEYS.map((key) => {
        const by = reactions.filter((r) => r.emoji === key);
        return (
          by.length > 0 && (
            <span
              key={key}
              className={s.wrap}
              data-held={held === key || undefined}
              onPointerEnter={side}
              onFocus={side}
            >
              <button
                type="button"
                className={s.chip}
                aria-pressed={mine(key)}
                aria-describedby={`${tipId}-${key}`}
                onTouchStart={() => {
                  press.current.held = false;
                  press.current.timer = setTimeout(() => {
                    press.current.held = true;
                    setHeld(key);
                  }, 400);
                }}
                // Cancelling the touch's end cancels the click it would make.
                onTouchEnd={(e) => {
                  release();
                  if (press.current.held) e.preventDefault();
                }}
                onTouchMove={release}
                onTouchCancel={release}
                onContextMenu={(e) => e.preventDefault()}
                onClick={() => onToggle(key)}
              >
                <span className={s.emoji}>{REACTIONS[key]}</span>
                {by.length}
              </button>
              <span id={`${tipId}-${key}`} role="tooltip" className={s.tip}>
                {by.map((r) => (
                  <span key={r.id} className={s.who}>
                    <Avatar
                      name={name(r.author)}
                      src={people.find((p) => p.id === r.author)?.avatar_url}
                      size={18}
                    />
                    <span className={s.name}>{name(r.author)}</span>
                  </span>
                ))}
              </span>
            </span>
          )
        );
      })}
    </div>
  );
}
