import { defineConfig } from "vite";

const WEB_HOST = process.env.WEB_HOST ?? "0.0.0.0";
const WEB_PORT = Number(process.env.WEB_PORT ?? 8080);

if (!Number.isInteger(WEB_PORT) || WEB_PORT < 1 || WEB_PORT > 65535) {
  throw new RangeError("WEB_PORT must be an integer from 1 through 65535");
}

export default defineConfig({
  base: "./",
  root: "src",
  build: {
    emptyOutDir: true,
    outDir: "../dist",
    target: "es2022",
  },
  worker: {
    format: "es",
  },
  preview: {
    host: WEB_HOST,
    port: WEB_PORT,
  },
  server: {
    host: WEB_HOST,
    port: WEB_PORT,
  },
});
