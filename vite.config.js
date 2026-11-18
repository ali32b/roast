import { defineConfig } from "vite";

// dev stays at "/", the static build lives under /roast/ on GitHub Pages
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/roast/" : "/",
  build: {
    target: "es2020",
  },
}));
