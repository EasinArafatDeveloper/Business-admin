"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CircleCheck, CloudUpload, LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui";
import { cn, nf } from "@/lib/utils";

type ImportRow = {
  id: number;
  fileName: string;
  sheet: string | null;
  status: "queued" | "running" | "done" | "failed";
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  error: string | null;
  createdAt: string;
};

export function ImportUploader() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportRow | null>(null);
  const [history, setHistory] = useState<ImportRow[]>([]);

  const loadHistory = () =>
    fetch("/api/leads/import")
      .then((r) => (r.ok ? r.json() : []))
      .then(setHistory)
      .catch(() => {});

  useEffect(() => {
    loadHistory();
  }, []);

  // Poll the running import every 1.5 s.
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/leads/import?id=${job.id}`);
      if (r.ok) {
        const next: ImportRow = await r.json();
        setJob(next);
        if (next.status === "done" || next.status === "failed") loadHistory();
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [job]);

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch("/api/leads/import", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Upload failed");
      setJob({ id: data.id, fileName: file.name, sheet: null, status: "queued", total: 0, inserted: 0, updated: 0, skipped: 0, error: null, createdAt: new Date().toISOString() });
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const running = job && (job.status === "queued" || job.status === "running");

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) setFile(f);
        }}
        onClick={() => input.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-accent bg-accent/10" : "border-line-strong bg-surface hover:border-accent/50"
        )}
      >
        <CloudUpload className="h-9 w-9 text-accent" />
        <p className="mt-3 font-medium">{file ? file.name : "Drop your .xlsx here, or click to choose"}</p>
        <p className="mt-1 text-sm text-muted">
          {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "Uses the “All Leads” sheet. Re-importing updates existing leads and keeps their status & notes."}
        </p>
        <input
          ref={input}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={upload} disabled={!file || uploading || Boolean(running)}>
          {uploading ? "Uploading…" : "Start import"}
        </Button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>

      {job && (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center gap-2 font-medium">
            {running && <LoaderCircle className="h-4 w-4 animate-spin text-accent" />}
            {job.status === "done" && <CircleCheck className="h-4 w-4 text-success" />}
            {job.status === "failed" && <TriangleAlert className="h-4 w-4 text-danger" />}
            {running ? "Importing…" : job.status === "done" ? "Import finished" : "Import failed"}
            {job.sheet && <span className="text-sm font-normal text-muted">· sheet “{job.sheet}”</span>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Rows read" value={job.total} />
            <Stat label="New leads" value={job.inserted} />
            <Stat label="Updated" value={job.updated} />
            <Stat label="Skipped" value={job.skipped} />
          </div>
          {job.error && <p className="mt-3 text-sm text-danger">{job.error}</p>}
          {job.status === "done" && (
            <Link href="/leads" className="mt-4 inline-block text-sm text-accent-soft hover:underline">
              Open leads →
            </Link>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted">Recent imports</h2>
          <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {history.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0 truncate">{h.fileName}</span>
                <span className="text-muted">
                  {h.status === "done"
                    ? `${nf.format(h.inserted)} new · ${nf.format(h.updated)} updated`
                    : h.status === "failed"
                      ? "failed"
                      : `${h.status}… ${nf.format(h.total)} rows`}{" "}
                  · {new Date(h.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-ink-alt p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold">{nf.format(value)}</div>
    </div>
  );
}
