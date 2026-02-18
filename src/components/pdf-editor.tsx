import React, { useState, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { 
  Save, Type, Upload, Eraser, MousePointer2, 
  Sparkles, X, Image as ImageIcon, PenTool, Trash2
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { modifyPdf, type PdfAnnotation } from "@/lib/pdf-utils";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const API_BASE = import.meta.env.PROD ? "/api" : "http://localhost:8787/api";
const WS_BASE = import.meta.env.PROD ? "wss://" + window.location.host + "/api" : "ws://localhost:8787/api";

export function PdfEditor() {
  const [file, setFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [deletedPages, setDeletedPages] = useState<number[]>([]);
  
  const [tool, setTool] = useState<"none" | "text" | "erase" | "draw" | "image">("none");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [aiSummary, setAiSummary] = useState<string>("");
  const [aiStatus, setAiStatus] = useState<"idle" | "thinking">("idle");
  
  // Drawing State
  const [currentPath, setCurrentPath] = useState<string>("");
  const [isDrawing, setIsDrawing] = useState(false);

  const transformRef = useRef<any>(null);

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      const fd = new FormData();
      fd.append("file", f);
      
      try {
        const res = await fetch(`${API_BASE}/session/upload`, { method: "POST", body: fd });
        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();
        setFile(f);
        setSessionId(data.id);
        connectWs(data.id);
      } catch (err) {
        console.error(err);
        alert("Upload failed");
      }
    }
  };

  const connectWs = (id: string) => {
    if (ws) ws.close();
    const socket = new WebSocket(`${WS_BASE}/session/ws?id=${id}`);
    
    socket.onopen = () => console.log("Connected");
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "sync-annotations") setAnnotations(msg.annotations);
      if (msg.type === "sync-deleted-pages") setDeletedPages(msg.deletedPages);
      if (msg.type === "ai-status") setAiStatus(msg.status);
      if (msg.type === "ai-result") {
        setAiSummary(msg.text);
        setAiStatus("idle");
      }
    };
    setWs(socket);
  };

  const syncAnnotations = (newAnnotations: PdfAnnotation[]) => {
      setAnnotations(newAnnotations);
      ws?.send(JSON.stringify({ type: "sync-annotations", annotations: newAnnotations }));
  };

  // --- Input Handlers ---

  const handlePageTap = (e: React.MouseEvent | React.TouchEvent, pageIndex: number) => {
    if (tool === "draw") return; // Handled by pointer events
    
    const target = e.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (tool === "text") {
       const text = prompt("Enter text:");
       if (text) {
         syncAnnotations([...annotations, {
           id: uuidv4(), type: "text", page: pageIndex + 1, x, y, text, color: "#000000", fontSize: 16
         }]);
       }
       setTool("none");
    } else if (tool === "erase") {
         syncAnnotations([...annotations, {
           id: uuidv4(), type: "rect", page: pageIndex + 1, x: x - 25, y: y - 10, width: 50, height: 20, color: "#ffffff"
         }]);
         setTool("none");
    } else if (tool === "image") {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (ev) => {
            const f = (ev.target as HTMLInputElement).files?.[0];
            if (f) {
                const reader = new FileReader();
                reader.onload = (readerEv) => {
                    const base64 = readerEv.target?.result as string;
                    // Resize logic could go here to save bandwidth
                    syncAnnotations([...annotations, {
                        id: uuidv4(), type: "image", page: pageIndex + 1, x, y, width: 100, height: 100, image: base64
                    }]);
                };
                reader.readAsDataURL(f);
            }
        };
        input.click();
        setTool("none");
    }
  };

  // Drawing Logic
  const startDrawing = (e: React.MouseEvent, pageIndex: number) => {
      if (tool !== "draw") return;
      setIsDrawing(true);
      const target = e.currentTarget as HTMLDivElement;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setCurrentPath(`M ${x} ${y}`);
  };

  const drawMove = (e: React.MouseEvent) => {
      if (!isDrawing || tool !== "draw") return;
      const target = e.currentTarget as HTMLDivElement;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setCurrentPath(prev => `${prev} L ${x} ${y}`);
  };

  const endDrawing = (pageIndex: number) => {
      if (!isDrawing || tool !== "draw") return;
      setIsDrawing(false);
      if (currentPath.length > 10) {
          syncAnnotations([...annotations, {
              id: uuidv4(), type: "path", page: pageIndex + 1, x: 0, y: 0, path: currentPath, color: "#ef4444", strokeWidth: 3
          }]);
      }
      setCurrentPath("");
  };

  const deletePage = (index: number) => {
      if (confirm(`Delete page ${index + 1}?`)) {
          const newDeleted = [...deletedPages, index];
          setDeletedPages(newDeleted);
          ws?.send(JSON.stringify({ type: "sync-deleted-pages", deletedPages: newDeleted }));
      }
  };

  const triggerAi = () => {
    if(!ws) return;
    setAiStatus("thinking");
    ws.send(JSON.stringify({ type: "ai-summarize" }));
  };

  const downloadPdf = async () => {
    if(!file) return;
    const modifiedBytes = await modifyPdf(file, annotations, deletedPages);
    const blob = new Blob([modifiedBytes as any], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "edited_" + file.name;
    link.click();
    
    if (sessionId) {
        const fd = new FormData();
        fd.append("file", blob, "edited_" + file.name);
        fetch(`${API_BASE}/session/save-changes?id=${sessionId}`, { method: "POST", body: fd });
    }
  };

  return (
    <div className="h-screen w-screen bg-slate-100 overflow-hidden flex flex-col relative">
      {/* Header */}
      <div className="absolute top-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
        <div className="bg-black/90 backdrop-blur-md text-white rounded-full px-6 py-2 shadow-2xl pointer-events-auto flex items-center gap-4">
           <span className="font-bold text-sm tracking-wide">Cloudflare PDF</span>
           {aiStatus === "thinking" && (
             <span className="text-xs bg-purple-600 px-2 py-0.5 rounded-full animate-pulse flex items-center gap-1">
               <Sparkles className="w-3 h-3" /> Thinking...
             </span>
           )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative z-0">
        {!file ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center">
            <div className="w-20 h-20 bg-blue-100 rounded-3xl flex items-center justify-center mb-6 text-blue-600">
               <Upload className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800">Tap to Upload</h2>
            <Button size="lg" className="rounded-full px-8 h-12 text-lg shadow-lg relative mt-6 cursor-pointer">
              <input type="file" accept="application/pdf" className="absolute inset-0 opacity-0 cursor-pointer" onChange={uploadFile} />
              Select PDF
            </Button>
          </div>
        ) : (
          <TransformWrapper
            ref={transformRef}
            initialScale={1}
            minScale={0.5}
            maxScale={4}
            centerOnInit
            disabled={tool !== "none"} 
          >
            <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full">
              <div className="w-full min-h-full flex flex-col items-center py-20 gap-8">
                 <Document file={file} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
                    {Array.from(new Array(numPages), (_, i) => {
                      if (deletedPages.includes(i)) return null; // Hide deleted pages
                      return (
                        <div 
                          key={i} 
                          className="relative shadow-2xl group"
                          onClick={(e) => handlePageTap(e, i)}
                          onMouseDown={(e) => startDrawing(e, i)}
                          onMouseMove={drawMove}
                          onMouseUp={() => endDrawing(i)}
                          onMouseLeave={() => endDrawing(i)}
                        >
                           <Page 
                             pageNumber={i + 1} 
                             width={window.innerWidth > 768 ? 600 : window.innerWidth * 0.9} 
                             renderTextLayer={false}
                             renderAnnotationLayer={false}
                           />
                           
                           {/* Page Delete Button */}
                           <Button 
                             size="icon" 
                             variant="destructive" 
                             className="absolute -right-12 top-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-full shadow-lg"
                             onClick={(e) => { e.stopPropagation(); deletePage(i); }}
                           >
                             <Trash2 className="w-4 h-4" />
                           </Button>

                           {/* Render Annotations */}
                           {annotations.filter(a => a.page === i + 1).map(ann => (
                             <div 
                               key={ann.id}
                               className="absolute pointer-events-none whitespace-pre"
                               style={{
                                 left: 0, top: 0, width: '100%', height: '100%'
                               }}
                             >
                               {ann.type === "text" && (
                                   <div style={{ position: "absolute", left: ann.x, top: ann.y, fontSize: ann.fontSize, color: ann.color, fontWeight: "bold" }}>
                                       {ann.text}
                                   </div>
                               )}
                               {ann.type === "rect" && (
                                   <div style={{ position: "absolute", left: ann.x, top: ann.y, width: ann.width, height: ann.height, backgroundColor: ann.color }} />
                               )}
                               {ann.type === "image" && (
                                   <img src={ann.image} style={{ position: "absolute", left: ann.x, top: ann.y, width: ann.width, height: ann.height, objectFit: "contain" }} />
                               )}
                               {ann.type === "path" && (
                                   <svg style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", overflow: "visible" }}>
                                       <path d={ann.path} stroke={ann.color} strokeWidth={ann.strokeWidth} fill="none" strokeLinecap="round" />
                                   </svg>
                               )}
                             </div>
                           ))}

                           {/* Active Drawing Path */}
                           {isDrawing && tool === "draw" && (
                               <svg className="absolute inset-0 w-full h-full pointer-events-none">
                                   <path d={currentPath} stroke="#ef4444" strokeWidth={3} fill="none" strokeLinecap="round" />
                               </svg>
                           )}
                        </div>
                      );
                    })}
                 </Document>
              </div>
            </TransformComponent>
          </TransformWrapper>
        )}
      </div>

      {/* Toolbar */}
      {file && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 z-50">
           <div className="bg-white rounded-full shadow-xl border p-1.5 flex items-center gap-1">
              <Button variant={tool === "none" ? "default" : "ghost"} size="icon" className="rounded-full w-12 h-12" onClick={() => setTool("none")}>
                <MousePointer2 className="w-5 h-5" />
              </Button>
              <Button variant={tool === "text" ? "default" : "ghost"} size="icon" className="rounded-full w-12 h-12" onClick={() => setTool("text")}>
                <Type className="w-5 h-5" />
              </Button>
              <Button variant={tool === "draw" ? "default" : "ghost"} size="icon" className="rounded-full w-12 h-12" onClick={() => setTool("draw")}>
                <PenTool className="w-5 h-5" />
              </Button>
              <Button variant={tool === "image" ? "default" : "ghost"} size="icon" className="rounded-full w-12 h-12" onClick={() => setTool("image")}>
                <ImageIcon className="w-5 h-5" />
              </Button>
              <Button variant={tool === "erase" ? "default" : "ghost"} size="icon" className="rounded-full w-12 h-12" onClick={() => setTool("erase")}>
                <Eraser className="w-5 h-5" />
              </Button>
           </div>

           <div className="bg-white rounded-full shadow-xl border p-1.5 flex items-center gap-1">
             <Button variant="outline" size="icon" className="rounded-full w-12 h-12 text-purple-600 bg-purple-50" onClick={triggerAi}>
                <Sparkles className="w-5 h-5" />
              </Button>
              <Button variant="default" size="icon" className="rounded-full w-12 h-12 bg-black text-white hover:bg-slate-800" onClick={downloadPdf}>
                <Save className="w-5 h-5" />
              </Button>
           </div>
        </div>
      )}

      {/* AI Modal */}
      {aiSummary && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <Card className="w-full max-w-lg p-6 relative max-h-[80vh] overflow-y-auto">
            <Button variant="ghost" size="icon" className="absolute top-2 right-2" onClick={() => setAiSummary("")}>
              <X className="w-4 h-4" />
            </Button>
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2 text-purple-700">
              <Sparkles className="w-5 h-5" /> Document Summary
            </h3>
            <div className="text-slate-700 leading-relaxed whitespace-pre-wrap font-mono text-sm">
              {aiSummary}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
