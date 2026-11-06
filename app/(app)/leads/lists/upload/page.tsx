import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { smsRate } from "@/lib/sms";
import { linkBase } from "@/lib/tracking";
import { UploadList } from "@/components/lists/upload-list";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const metadata = { title: "Upload a list" };

export default async function UploadListPage({ searchParams }: PageProps<"/leads/lists/upload">) {
  const user = await requireAccess("leads");
  const sp = await searchParams;
  const listId = Number(sp.list) || 0;
  const [intoList] = listId
    ? await db
        .select({ id: schema.leadLists.id, name: schema.leadLists.name })
        .from(schema.leadLists)
        .where(and(eq(schema.leadLists.id, listId), eq(schema.leadLists.workspaceId, user.workspaceId)))
        .limit(1)
    : [];
  const then = sp.then === "campaign" ? "campaign" : undefined;
  const channel = typeof sp.channel === "string" ? sp.channel : undefined;
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href={then ? "/campaigns/new" : "/leads/lists"} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> {then ? "New campaign" : "Saved lists"}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{intoList ? `Update “${intoList.name}” from a file` : "Upload a list"}</h1>
        <p className="mt-1 text-sm text-muted">
          Excel or CSV with each person&apos;s number (and their own message, if you wrote one). Campaigns to this list send each person their own text.
        </p>
      </div>
      <UploadList rate={smsRate()} linkBase={linkBase()} then={then} channel={channel} intoList={intoList} />
    </div>
  );
}
