import { requireUser } from "@/lib/auth";
import { ImportUploader } from "@/components/leads/import-uploader";

export const metadata = { title: "Import leads" };

export default async function ImportPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import leads</h1>
        <p className="mt-1 text-sm text-muted">
          Upload the Excel file from FB Ad Lead Finder. Leads are matched by their Facebook page link, so importing a newer
          file adds new businesses and refreshes the old ones without losing your work.
        </p>
      </div>
      <ImportUploader />
    </div>
  );
}
