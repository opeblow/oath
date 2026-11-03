import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Serve the Vercel functions in api/ during `npm run dev`. */
function devApi(): Plugin {
  return {
    name: "oath-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/ask", async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const mod = await server.ssrLoadModule("/api/ask.ts");
        const request = new Request("http://localhost/api/ask", {
          method: req.method,
          headers: { "content-type": "application/json", "x-forwarded-for": req.socket.remoteAddress ?? "local" },
          body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
        });
        const out: Response = req.method === "POST" ? await mod.POST(request) : new Response("Method not allowed", { status: 405 });
        res.statusCode = out.status;
        out.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await out.arrayBuffer()));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Server-only secrets (no VITE_ prefix) for the dev API; never exposed to the client bundle.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
    plugins: [react(), devApi()],
    server: { port: 5173 },
    build: { sourcemap: true, chunkSizeWarningLimit: 900 },
  };
});
