import { REACTIONS, personName, type Reaction, type ReactionKey, type User } from "../api";
import { useT } from "../i18n";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Menu } from "./Menu";
import s from "./Reactions.module.css";
import { Tip } from "./Tip";

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
            <Tip
              key={key}
              tip={by.map((r) => (
                <span key={r.id} className={s.who}>
                  <Avatar
                    name={name(r.author)}
                    src={people.find((p) => p.id === r.author)?.avatar_url}
                    size={18}
                  />
                  <span className={s.name}>{name(r.author)}</span>
                </span>
              ))}
            >
              {(describedBy) => (
                <button
                  type="button"
                  className={s.chip}
                  aria-pressed={mine(key)}
                  aria-describedby={describedBy}
                  onClick={() => onToggle(key)}
                >
                  <span className={s.emoji}>{REACTIONS[key]}</span>
                  {by.length}
                </button>
              )}
            </Tip>
          )
        );
      })}
    </div>
  );
}
