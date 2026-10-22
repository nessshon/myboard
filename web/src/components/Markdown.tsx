import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { personName, type User } from "../api";
import s from "./Markdown.module.css";

const plugins = [remarkGfm];

// A mention is [@Name](user:ID), as the bot reads it too (internal/bot/notify.go): it is drawn with the
// person's current name, never as a link; the link text is only a fallback.
export const mentions = /\[@([^\]\n]*)\]\(user:([a-z0-9]{15})\)/g;
// Brackets, a backslash or a line break in a name would break the link or the bot's pattern.
export const mentionOf = (name: string, id: string) =>
  `[@${name.replace(/[[\]\\]/g, "").replace(/\s+/g, " ")}](user:${id})`;
const mentionHref = /^user:([a-z0-9]{15})$/;

// Raw HTML stays text (no rehype-raw); links other than mentions go through react-markdown's
// default urlTransform, which drops unsafe ones.
const urlTransform = (url: string, key: string) =>
  key === "href" && mentionHref.test(url) ? url : defaultUrlTransform(url);

export function Markdown({ text, people = [] }: { text: string; people?: User[] }) {
  const components: Components = {
    a: ({ href = "", title, children }) => {
      const id = mentionHref.exec(href)?.[1];
      if (!id) {
        return (
          <a href={href} title={title} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }
      const person = people.find((p) => p.id === id);
      return person ? <span className={s.mention}>@{personName(person)}</span> : <>{children}</>;
    },
  };
  return (
    <div className={s.md}>
      <ReactMarkdown remarkPlugins={plugins} components={components} urlTransform={urlTransform}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
