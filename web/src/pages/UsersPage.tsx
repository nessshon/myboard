import { ClientResponseError } from "pocketbase";
import { useEffect, useId, useState, type FormEvent } from "react";
import { addUser, removeUser, setRole, users as listUsers, type User, personName } from "../api";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ProjectDialogs";
import { Section } from "../components/Section";
import { Select } from "../components/Select";
import { toast } from "../components/Toast";
import { useLang, useT, type Key } from "../i18n";
import s from "./Table.module.css";
import { formatDay } from "../format";

type Role = User["role"];

export function UsersPage({ me }: { me: User }) {
  const t = useT();
  const lang = useLang();
  const hintId = useId();
  const [list, setList] = useState<User[] | null>(null);
  const [draftId, setDraftId] = useState("");
  const [draftRole, setDraftRole] = useState<Role>("member");
  const [error, setError] = useState<Key | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const failed = () => toast(t("common.loadFailed"));
  const reload = () => listUsers().then(setList).catch(failed);

  useEffect(() => {
    reload();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    const id = draftId.trim();
    if (!/^[1-9]\d{0,15}$/.test(id)) return setError("users.badId");
    try {
      await addUser(id, draftRole);
      setDraftId("");
      setError(null);
      reload();
    } catch (err) {
      const status = err instanceof ClientResponseError ? err.status : 0;
      setError(
        status === 409 ? "users.exists" : status === 400 ? "users.badId" : "common.saveFailed",
      );
    }
  }

  function patchRole(id: string, role: Role) {
    setList((xs) => xs && xs.map((x) => (x.id === id ? { ...x, role } : x)));
  }

  async function changeRole(u: User, role: Role) {
    patchRole(u.id, role);
    try {
      await setRole(u.id, role);
    } catch {
      patchRole(u.id, u.role);
      toast(t("common.saveFailed"));
    }
  }

  async function remove(u: User) {
    setConfirming(null);
    try {
      await removeUser(u.id);
      setList((xs) => xs && xs.filter((x) => x.id !== u.id));
    } catch {
      toast(t("common.saveFailed"));
    }
  }

  const removing = list?.find((x) => x.id === confirming);
  const roleName = (role: Role) => t(role === "admin" ? "users.admin" : "users.member");

  return (
    <div className={s.page}>
      <Section title={t("users.addTitle")}>
        <form className={`${s.box} ${s.form}`} onSubmit={add} noValidate>
          <label className={`${s.field} ${s.grow}`}>
            <span className="caption">Telegram ID</span>
            <input
              className={`input ${s.mono}`}
              inputMode="numeric"
              placeholder="123456789"
              value={draftId}
              aria-invalid={error === "users.badId"}
              aria-describedby={hintId}
              onChange={(e) => {
                setDraftId(e.target.value);
                setError(null);
              }}
            />
          </label>
          <label className={s.field}>
            <span className="caption">{t("users.role")}</span>
            <Select value={draftRole} onChange={(e) => setDraftRole(e.target.value as Role)}>
              <option value="member">{t("users.member")}</option>
              <option value="admin">{t("users.admin")}</option>
            </Select>
          </label>
          <Button type="submit" variant="primary" icon="plus">
            {t("common.add")}
          </Button>
          <span id={hintId} className={s.formError} aria-live="polite">
            {error && t(error)}
          </span>
        </form>
      </Section>

      <Section title={t("users.members")} count={list?.length}>
        {list && (
          <div className={`${s.box} ${s.scroll}`}>
            <table className={`${s.table} ${s.cards}`}>
              <thead>
                <tr>
                  <th>{t("users.user")}</th>
                  <th>Telegram ID</th>
                  <th>{t("users.role")}</th>
                  <th>{t("users.state")}</th>
                  <th>{t("users.lastLogin")}</th>
                  <th className={s.right}>{t("users.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => {
                  const name = u.name || u.username;
                  const isOwner = u.owner === true;
                  const isMe = u.id === me.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        <span className={s.who}>
                          {name ? (
                            <Avatar name={name} src={u.avatar_url} size={28} />
                          ) : (
                            <span className={s.unknown} aria-hidden="true">
                              ?
                            </span>
                          )}
                          <span className={s.names}>
                            <span className={`${s.name} ${name ? "" : s.minor}`} title={name}>
                              {name || t("users.unknown")}
                            </span>
                            {name && (
                              <span className={s.minor}>
                                {u.username ? `@${u.username}` : t("users.noUsername")}
                              </span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td className={s.mono}>{u.tg_id}</td>
                      <td>
                        {isOwner ? (
                          <span className={s.chip} title={t("users.ownerHint")}>
                            {t("users.owner")}
                          </span>
                        ) : isMe ? (
                          <span className={s.chip}>{roleName(u.role)}</span>
                        ) : (
                          <Select
                            className={s.roleSelect}
                            aria-label={`${t("users.role")}: ${name || u.tg_id}`}
                            value={u.role}
                            onChange={(e) => changeRole(u, e.target.value as Role)}
                          >
                            <option value="member">{t("users.member")}</option>
                            <option value="admin">{t("users.admin")}</option>
                          </Select>
                        )}
                      </td>
                      <td>
                        <span className={s.chip}>
                          <span
                            className={s.stateDot}
                            style={{ background: u.last_login ? "var(--ok)" : "var(--warn)" }}
                            aria-hidden="true"
                          />
                          {t(u.last_login ? "users.active" : "users.invited")}
                        </span>
                      </td>
                      <td className={s.muted}>
                        {u.last_login ? formatDay(u.last_login, lang) : "—"}
                      </td>
                      <td className={s.right}>
                        {isMe ? (
                          <span className={s.minor}>{t("users.itsYou")}</span>
                        ) : isOwner ? null : (
                          <Button size="sm" onClick={() => setConfirming(u.id)}>
                            {t("common.delete")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <ConfirmDialog
        open={!!removing}
        title={t("users.removeTitle", { name: removing ? personName(removing) : "" })}
        text={t("users.removeText")}
        confirm={t("common.delete")}
        onClose={() => setConfirming(null)}
        onConfirm={() => removing && remove(removing)}
      />
    </div>
  );
}
