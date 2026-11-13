import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { common, createLowlight } from "lowlight";
import { useMemo } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

const lowlight = createLowlight(common);

// The language is told by an extension, a name such as Makefile or a code block's tag, as highlight.js knows
// them. Anything else stays plain: guessing is slow and often wrong. Built as React elements, the text never
// becomes HTML.
export function Highlight({ text, language }: { text: string; language: string }) {
  return useMemo(
    () =>
      lowlight.registered(language)
        ? toJsxRuntime(lowlight.highlight(language, text), { Fragment, jsx, jsxs })
        : text,
    [text, language],
  );
}
