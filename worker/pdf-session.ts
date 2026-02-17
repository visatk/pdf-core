import { DurableObject } from "cloudflare:workers";

export interface Env {
  PDF_BUCKET: R2Bucket;
  PDF_SESSION: DurableObjectNamespace;
  AI: Ai;
}

export class PDFSession extends DurableObject<Env> {
  // Store session metadata in memory (fast access)
  private meta: { fileName?: string; uploadedAt?: number } = {};

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.split("/").slice(2).join("/"); // strips /api/session/<id>

    try {
      switch (path) {
        case "upload":
          return await this.handleUpload(request);
        case "download":
          return await this.handleDownload();
        case "metadata":
          return Response.json(this.meta);
        default:
          return new Response("Method not allowed", { status: 405 });
      }
    } catch (err) {
      return new Response((err as Error).message, { status: 500 });
    }
  }

  async handleUpload(request: Request): Promise<Response> {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    
    if (!file) return new Response("No file uploaded", { status: 400 });

    // Save to R2 using the Session ID as the key (1 session = 1 PDF)
    const key = `${this.ctx.id.toString()}.pdf`;
    await this.env.PDF_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    // Update internal state
    this.meta = {
      fileName: file.name,
      uploadedAt: Date.now(),
    };

    return Response.json({ 
      success: true, 
      id: this.ctx.id.toString(),
      meta: this.meta 
    });
  }

  async handleDownload(): Promise<Response> {
    const key = `${this.ctx.id.toString()}.pdf`;
    const object = await this.env.PDF_BUCKET.get(key);

    if (!object) return new Response("PDF Not Found", { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    // Important for frontend to know it's a PDF
    headers.set("Content-Type", "application/pdf"); 

    return new Response(object.body, { headers });
  }
}
