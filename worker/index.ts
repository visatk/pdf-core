import { PDFSession, type Env } from "./pdf-session"; // Added 'type' keyword

// Export the class so Cloudflare can find it
export { PDFSession };

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. CORS Preflight (Crucial for frontend fetching)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    // 2. API Routing
    if (url.pathname.startsWith("/api/session")) {
      // Logic: If 'id' query param exists, use it. Otherwise, create new unique ID.
      const idParam = url.searchParams.get("id");
      const id = idParam 
        ? env.PDF_SESSION.idFromString(idParam) 
        : env.PDF_SESSION.newUniqueId();
      
      const stub = env.PDF_SESSION.get(id);
      
      // Forward the request to the Durable Object
      const response = await stub.fetch(request);
      
      // Re-attach CORS headers to the response
      const newHeaders = new Headers(response.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    }

    return new Response("PDF Core API Running", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
