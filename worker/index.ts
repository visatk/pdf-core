import { PDFSession, type Env } from "./pdf-session";
export { PDFSession };

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Upgrade, WebSocket",
        },
      });
    }

    if (url.pathname.startsWith("/api/session")) {
      const idParam = url.searchParams.get("id");
      const id = idParam ? env.PDF_SESSION.idFromString(idParam) : env.PDF_SESSION.newUniqueId();
      const stub = env.PDF_SESSION.get(id);
      
      // Pass upgrade header for WebSockets
      if (request.headers.get("Upgrade") === "websocket") {
         return stub.fetch(request);
      }

      const response = await stub.fetch(request);
      // Re-attach CORS
      const newHeaders = new Headers(response.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      return new Response(response.body, { status: response.status, headers: newHeaders });
    }

    return new Response("Cloudflare PDF Core Ready", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
