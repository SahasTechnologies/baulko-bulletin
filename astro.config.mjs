import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import vercel from "@astrojs/vercel";

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
  site: "https://baulkobulletin.com",
  output: "server",
  adapter: vercel(),
  server: {
    host: true,
    port: 4321,
  },
});
