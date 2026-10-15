import fs from "node:fs";
import path from "node:path";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vitest/config";

const metricsFile = path.resolve(__dirname, ".metrics/events.jsonl");

function metricsApi(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split("?")[0];
    if (url !== "/api/metrics") return next();
    if (req.method === "GET") {
      const body = fs.existsSync(metricsFile) ? fs.readFileSync(metricsFile, "utf8") : "";
      res.setHeader("Content-Type", "application/x-ndjson");
      res.end(body);
      return;
    }
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        fs.mkdirSync(path.dirname(metricsFile), { recursive: true });
        const text = Buffer.concat(chunks).toString("utf8").trim();
        if (text) fs.appendFileSync(metricsFile, text + "\n");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    next();
  };
  return {
    name: "bard-metrics-api",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [metricsApi()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        a: path.resolve(__dirname, "a.html"),
        b: path.resolve(__dirname, "b.html"),
      },
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
