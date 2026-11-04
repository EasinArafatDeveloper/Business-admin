import type { MetadataRoute } from "next";

/** Private admin: no crawling at all. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
