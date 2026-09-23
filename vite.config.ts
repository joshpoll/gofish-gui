import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// gofish-graphics is linked from the sibling monorepo checkout and consumed
// through its built `dist/` (see README, "Depending on gofish"). Its dist
// keeps `solid-js` external, and a linked package would normally resolve that
// import from ITS OWN node_modules, loading a second copy of Solid (two
// reactive runtimes = broken ownership/disposal). `dedupe` makes every
// `solid-js` import resolve from this app's root instead.
export default defineConfig({
  plugins: [solid()],
  resolve: {
    dedupe: ["solid-js"],
  },
  server: {
    fs: {
      // Allow serving the linked sibling package's files.
      allow: [".", "../gofish-20250316/packages/gofish-graphics"],
    },
  },
});
