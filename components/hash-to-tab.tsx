"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Old links like /channels#email open the matching ?tab=email. */
export function HashToTab({ tabs }: { tabs: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && tabs.includes(hash) && params.get("tab") !== hash) router.replace(`${pathname}?tab=${hash}`);
  }, [tabs, router, pathname, params]);
  return null;
}
