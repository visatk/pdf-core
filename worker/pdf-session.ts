import { DurableObject } from "cloudflare:workers";
import { extractText, getDocumentProxy } from "unpdf";

// Re-defining interface here to avoid build dependency issues between worker/app
export interface PdfAnnotation {
	id: string;
	type: "text" | "rect" | "image" | "path" | "text-replace";
	page: number;
	x: number;
	y: number;
	text?: string;
    fontSize?: number;
	width?: number;
	height?: number;
	color?: string;
    image?: string;
    path?: string;
    strokeWidth?: number;
    originalTextRect?: { x: number; y: number; width: number; height: number };
}

export type WSMessage =
	| { type: "sync-annotations"; annotations: PdfAnnotation[] }
    | { type: "sync-deleted-pages"; deletedPages: number[] }
	| { type: "cursor-move"; x: number; y: number; page: number; clientId: string }
	| { type: "ai-summarize" }
	| { type: "ai-status"; status: "thinking" | "ready" | "error" }
	| { type: "ai-result"; text: string };

export class PDFSession extends DurableObject<Env> {
	private sessions: Set<WebSocket> = new Set();
	private annotations: PdfAnnotation[] = [];
    private deletedPages: Set<number> = new Set();
	private pdfKey: string;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.pdfKey = `${this.ctx.id.toString()}.pdf`;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname.split("/").pop(); 

		if (request.headers.get("Upgrade") === "websocket") {
			return this.handleWebSocket(request);
		}

		switch (path) {
			case "upload": return this.handleUpload(request);
			case "download": return this.handleDownload();
			case "save-changes": return this.handleSaveChanges(request);
			default: return new Response("Not found", { status: 404 });
		}
	}

	async handleWebSocket(_request: Request): Promise<Response> {
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		this.ctx.acceptWebSocket(server);
		this.sessions.add(server);

		// Send initial state
		server.send(JSON.stringify({ type: "sync-annotations", annotations: this.annotations }));
        server.send(JSON.stringify({ type: "sync-deleted-pages", deletedPages: Array.from(this.deletedPages) }));

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		try {
			const data = JSON.parse(message as string) as WSMessage;

			switch (data.type) {
				case "sync-annotations":
					this.annotations = data.annotations;
					this.broadcast(message as string, ws);
					break;
                case "sync-deleted-pages":
                    this.deletedPages = new Set(data.deletedPages);
                    this.broadcast(message as string, ws);
                    break;
				case "cursor-move":
					this.broadcast(message as string, ws);
					break;
				case "ai-summarize":
					this.ctx.waitUntil(this.runAiSummary(ws));
					break;
			}
		} catch (err) {
			console.error("WS Error:", err);
		}
	}

	async webSocketClose(ws: WebSocket) {
		this.sessions.delete(ws);
	}

	broadcast(msg: string, source?: WebSocket) {
		for (const session of this.sessions) {
			if (session !== source) {
				try { session.send(msg); } catch (e) { this.sessions.delete(session); }
			}
		}
	}

    // ... (rest of the file: runAiSummary, handleUpload, handleDownload, handleSaveChanges remain unchanged)
    async runAiSummary(requestorWs: WebSocket) {
		requestorWs.send(JSON.stringify({ type: "ai-status", status: "thinking" }));

		const pdfObject = await this.env.PDF_BUCKET.get(this.pdfKey);
		if (!pdfObject) {
			requestorWs.send(JSON.stringify({ type: "ai-result", text: "Error: No PDF found." }));
			return;
		}

		try {
			const arrayBuffer = await pdfObject.arrayBuffer();
			const pdfData = new Uint8Array(arrayBuffer);
			const pdf = await getDocumentProxy(pdfData);
			const { text } = await extractText(pdf, { mergePages: true });
			const safeText = Array.isArray(text) ? text.join(" ") : text;
            
			const response = await this.env.AI.run("@cf/meta/llama-3-8b-instruct", {
				messages: [
					{ role: "system", content: "Summarize this document concisely." },
					{ role: "user", content: safeText.slice(0, 12000) },
				],
			});
			const summary = (response as { response: string }).response;
			const resultMsg = JSON.stringify({ type: "ai-result", text: summary });
			this.broadcast(resultMsg); 
			requestorWs.send(resultMsg); 
		} catch (e) {
			requestorWs.send(JSON.stringify({ type: "ai-result", text: "Error processing analysis." }));
		}
	}

    async handleUpload(request: Request): Promise<Response> {
		const formData = await request.formData();
		const file = formData.get("file") as File;
		if (!file) return new Response("No file uploaded", { status: 400 });

		await this.env.PDF_BUCKET.put(this.pdfKey, file.stream(), {
			httpMetadata: { contentType: file.type },
		});
		return Response.json({ id: this.ctx.id.toString() });
	}

	async handleDownload(): Promise<Response> {
		const object = await this.env.PDF_BUCKET.get(this.pdfKey);
		if (!object) return new Response("Not found", { status: 404 });
		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set("etag", object.httpEtag);
		return new Response(object.body, { headers });
	}

	async handleSaveChanges(request: Request): Promise<Response> {
		const formData = await request.formData();
		const file = formData.get("file") as File;
        if (!file) return new Response("No file", { status: 400 });
		await this.env.PDF_BUCKET.put(this.pdfKey, file.stream(), {
			httpMetadata: { contentType: "application/pdf" },
		});
		return Response.json({ success: true });
	}
}
