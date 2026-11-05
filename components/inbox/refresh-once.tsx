"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the layout once so the sidebar unread badge drops after a thread is opened. */
export function RefreshOnce() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
