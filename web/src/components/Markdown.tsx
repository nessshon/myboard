import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import s from "./Markdown.module.css";

const plugins = [remarkGfm];

// Raw HTML stays text (no rehype-raw); react-markdown's default urlTransform drops unsafe links.
const components: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className={s.md}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
