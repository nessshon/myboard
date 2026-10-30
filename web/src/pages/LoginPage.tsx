import { useEffect, useState } from "react";
import {
  devLogin,
  devUsers,
  finishTelegramLogin,
  boot,
  loginWithTelegram,
  noAccessId,
} from "../api";
import { copyText } from "../browser";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Logo } from "../components/Logo";
import { ThemeSwitch } from "../components/ThemeSwitch";
import { toast } from "../components/Toast";
import { setLang, useLang, useT } from "../i18n";
import { navigate } from "../router";
import s from "./LoginPage.module.css";

type DevUser = Awaited<ReturnType<typeof devUsers>>[number];

export function LoginPage() {
  const t = useT();
  const lang = useLang();
  const [denied, setDenied] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dev, setDev] = useState<DevUser[]>([]);

  useEffect(() => {
    if (boot.dev ?? import.meta.env.DEV)
      devUsers()
        .then(setDev)
        .catch(() => toast(t("common.loadFailed")));
  }, []);

  useEffect(() => {
    const back = new URLSearchParams(location.search);
    if (!back.has("state")) return;
    navigate("/login", true); // a code works once: a reload must not send it again
    finishTelegramLogin(back.get("code"), back.get("state")).catch(failed);
  }, []);

  const failed = (err: unknown) => {
    const id = noAccessId(err);
    if (!id) return toast(t("login.failed"));
    setCopied(false);
    setDenied(id);
  };

  function login() {
    loginWithTelegram().catch(failed);
  }

  return (
    <div className={s.page}>
      <header className={s.top}>
        <button
          type="button"
          className={s.lang}
          aria-label={t("header.switchLang")}
          title={t("header.switchLang")}
          onClick={() => setLang(lang === "ru" ? "en" : "ru")}
        >
          <Icon name="globe" />
          {lang.toUpperCase()}
        </button>
        <ThemeSwitch />
      </header>
      <main className={s.main}>
        <div className={s.card}>
          <div className={s.pair} aria-hidden="true">
            <Logo className={s.logo} />
            <span className={s.link} />
            <span className={s.tgMark}>
              <Icon name="telegram" size={26} />
            </span>
          </div>
          {denied ? (
            <>
              <div>
                <h1 className={s.title}>{t("login.deniedTitle")}</h1>
                <p className={s.text}>{t("login.deniedText")}</p>
              </div>
              <div className={s.idBox}>
                <span className={s.id}>{denied}</span>
                <Button
                  variant="ghost"
                  icon="copy"
                  aria-live="polite"
                  onClick={() =>
                    copyText(denied)
                      .then(() => setCopied(true))
                      .catch(() => toast(t("common.copyFailed")))
                  }
                >
                  {t(copied ? "common.copied" : "common.copy")}
                </Button>
              </div>
              <Button icon="telegram" onClick={() => setDenied(null)}>
                {t("login.otherAccount")}
              </Button>
            </>
          ) : (
            <>
              <div>
                <h1 className={s.title}>{t("login.title")}</h1>
                <p className={s.text}>{t("login.subtitle")}</p>
              </div>
              <button type="button" className={s.tg} onClick={login}>
                <Icon name="telegram" size={18} />
                {t("login.telegram")}
              </button>
              <p className={s.hint}>{t("login.hint")}</p>
              {dev.length > 0 && (
                <section className={s.dev}>
                  <h2 className={`caps ${s.devTitle}`}>{t("login.dev")}</h2>
                  {dev.map((u) => (
                    <button
                      key={u.tg_id}
                      type="button"
                      className={s.devUser}
                      onClick={() => devLogin(u.tg_id).catch(() => toast(t("login.failed")))}
                    >
                      <Avatar name={u.name || u.tg_id} size={24} />
                      <span className={`ellipsis ${s.devName}`}>{u.name || u.tg_id}</span>
                      <span className="hint">
                        {t(u.role === "admin" ? "users.admin" : "users.member")}
                      </span>
                    </button>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
