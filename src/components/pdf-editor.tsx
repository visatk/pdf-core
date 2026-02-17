import React, { useState, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Loader2, Save, Type, Upload } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { modifyPdf, PdfAnnotation } from "@/lib/pdf-utils";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Determine API URL based on environment
const API_BASE = import.meta.env.PROD ? "/api" : "http://localhost:8787/api";

export function PdfEditor() {
  const [file, setFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1.0);
  const [tool, setTool] = useState<"none" | "text">("none");
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // 1. Handle File Upload (Starts Session)
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);

      const formData = new FormData();
      formData.append("file", selectedFile);

      try {
        const res = await fetch(`${API_BASE}/session/upload`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json() as { id: string };
        setSessionId(data.id);
        console.log("Session started:", data.id);
      } catch (err) {
        console.error("Upload failed", err);
      }
    }
  };

  // 2. Add Annotation on Click
  const handlePageClick = (e: React.MouseEvent, pageIndex: number) => {
    if (tool !== "text") return;

    const rect = e.currentTarget.getBoundingClientRect();
    // Calculate relative coordinates normalized by scale
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    const text = prompt("Enter text to add:");
    if (!text) return;

    setAnnotations((prev) => [
      ...prev,
      {
        id: uuidv4(),
        type: "text",
        page: pageIndex + 1, // PDF pages are 1-based
        x,
        y,
        text,
      },
    ]);
    setTool("none"); // Reset tool
  };

  // 3. Save Changes (Merge & Download)
  const handleSave = async () => {
    if (!file) return;
    setIsSaving(true);
    try {
      // Burn annotations into PDF
      const pdfBytes = await modifyPdf(file, annotations);
      
      // Create a Blob and trigger download
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `edited-${file.name}`;
      link.click();
      
      // Optional: Upload new version back to session
      if (sessionId) {
        const formData = new FormData();
        formData.append("file", blob, file.name);
        await fetch(`${API_BASE}/session/upload?id=${sessionId}`, {
           method: "POST",
           body: formData
        });
      }
    } catch (e) {
      console.error(e);
      alert("Error saving PDF");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Toolbar */}
      <header className="flex items-center justify-between p-4 bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tight">PDF Core</h1>
          <div className="flex gap-2">
            <Button
              variant={tool === "text" ? "secondary" : "ghost"}
              onClick={() => setTool("text")}
              disabled={!file}
            >
              <Type className="w-4 h-4 mr-2" />
              Add Text
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
           <Button variant="outline" className="relative cursor-pointer">
              <Upload className="w-4 h-4 mr-2" />
              Open PDF
              <input 
                type="file" 
                accept="application/pdf"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={onFileChange}
              />
           </Button>
           
           <Button onClick={handleSave} disabled={!file || isSaving}>
             {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Save className="w-4 h-4 mr-2" />}
             Save & Download
           </Button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 overflow-auto p-8 flex justify-center">
        {!file ? (
          <div className="flex flex-col items-center justify-center text-gray-400 mt-20">
            <div className="w-16 h-16 border-2 border-dashed rounded-lg flex items-center justify-center mb-4">
              <Upload className="w-8 h-8" />
            </div>
            <p>Upload a document to get started</p>
          </div>
        ) : (
          <div className="relative shadow-xl">
             <Document
                file={file}
                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                className="flex flex-col gap-4"
              >
                {Array.from(new Array(numPages), (el, index) => (
                  <div 
                    key={`page_${index + 1}`} 
                    className="relative group bg-white"
                    onClick={(e) => handlePageClick(e, index)}
                    style={{ cursor: tool === "text" ? "crosshair" : "default" }}
                  >
                    <Page 
                      pageNumber={index + 1} 
                      scale={scale} 
                      renderTextLayer={false} 
                      renderAnnotationLayer={false}
                    />
                    
                    {/* Annotation Overlay Layer */}
                    {annotations
                      .filter(a => a.page === index + 1)
                      .map((ann) => (
                        <div
                          key={ann.id}
                          className="absolute text-black font-sans pointer-events-none"
                          style={{
                            left: ann.x * scale,
                            top: ann.y * scale,
                            transform: "translateY(-100%)", // Text draws upwards from baseline usually
                            fontSize: `${12 * scale}px`,
                            lineHeight: 1
                          }}
                        >
                          {ann.text}
                        </div>
                      ))}
                  </div>
                ))}
              </Document>
          </div>
        )}
      </main>
    </div>
  );
}
