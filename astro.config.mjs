import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import vercel from "@astrojs/vercel";

export default defineConfig({
  devToolbar: { enabled: false },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    // pdf.js is imported on demand, from two entry points, by the issue reader.
    // A dependency Vite has not seen yet is bundled the first time something
    // asks for it, which changes the hash in every pre-bundled module's URL —
    // and any page loaded before that points at URLs that no longer exist, so
    // its requests come back "504 Outdated Optimize Dep" and the reader never
    // opens. Naming both entry points up front keeps them in the startup
    // bundle, so a reader can never be the request that triggers a re-bundle.
    optimizeDeps: {
      include: ["pdfjs-dist", "pdfjs-dist/legacy/build/pdf.mjs"],
    },
  },
  site: "https://baulkobulletin.com",
  output: "server",
  adapter: vercel(),
  server: {
    host: true,
    port: 4321,
  },
});
