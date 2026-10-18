import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.MYBOARD_API ?? "http://127.0.0.1:8090";

export default defineConfig({
  plugins: [
    react(),
    {
      // The backend writes its state into the page it serves (cmd/main.go, withBoot); Vite's page takes
      // a copy, so the version and the bot show in dev too. A backend without a built UI has none.
      name: "boot",
      apply: "serve",
      async transformIndexHtml(html) {
        const page = await fetch(backend + "/login")
          .then((r) => r.text())
          .catch(() => "");
        const tag = page.match(/<script type="application\/json" id="boot">.*?<\/script>/s)?.[0];
        return tag ? html.replace("</head>", tag + "</head>") : html;
      },
    },
    {
      // web/embed.go needs a file in dist on a fresh clone (it is tracked); the build empties dist.
      name: "gitkeep",
      apply: "build",
      closeBundle() {
        writeFileSync(
          resolve(this.environment.config.root, this.environment.config.build.outDir, ".gitkeep"),
          "",
        );
      },
    },
  ],
  server: {
    proxy: {
      "/api": backend,
    },
  },
});
