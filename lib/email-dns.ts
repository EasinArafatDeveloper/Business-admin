import "server-only";
import { Resolver } from "node:dns/promises";

/** Which SPF include each SMTP host needs so receivers trust mail "from" your domain. */
const SPF_INCLUDE: Record<string, string> = {
  "smtp.gmail.com": "_spf.google.com",
  "smtp-relay.brevo.com": "spf.brevo.com",
  "smtp.zoho.com": "zoho.com"
};

export type DnsCheck = { key: string; label: string; ok: boolean; detail: string; fix?: string };

/** Live DNS checklist for a sending domain (public resolvers, a few seconds at most). */
export async function checkDomain(domain: string, smtpHost: string): Promise<DnsCheck[]> {
  const r = new Resolver({ timeout: 3000, tries: 1 });
  r.setServers(["1.1.1.1", "8.8.8.8"]);
  const txt = async (name: string) => (await r.resolveTxt(name).catch(() => [] as string[][])).map((p) => p.join(""));
  const [mx, root, dmarc] = await Promise.all([r.resolveMx(domain).catch(() => []), txt(domain), txt(`_dmarc.${domain}`)]);

  const spf = root.find((t) => t.toLowerCase().startsWith("v=spf1"));
  const need = SPF_INCLUDE[smtpHost];
  const checks: DnsCheck[] = [
    {
      key: "mx",
      label: "Receives email (MX)",
      ok: mx.length > 0,
      detail: mx.length ? mx.map((m) => m.exchange).join(", ") : "No MX record — mail to this domain bounces",
      fix: "Cloudflare → Email → Email Routing → enable, then add a rule for the address"
    },
    {
      key: "spf",
      label: "Allowed to send (SPF)",
      ok: Boolean(spf && (!need || spf.toLowerCase().includes(`include:${need}`))),
      detail: spf ?? "No SPF record",
      fix: need
        ? `Edit the TXT record at ${domain} to: ${spf ? spf.replace(/\s*[~?-]all\s*$/i, "") : "v=spf1"} include:${need} ~all`
        : "Add your provider's include to the SPF TXT record"
    },
    {
      key: "dmarc",
      label: "DMARC policy",
      ok: dmarc.some((t) => t.toLowerCase().startsWith("v=dmarc1")),
      detail: dmarc[0] ?? "No DMARC record",
      fix: `Add TXT record _dmarc.${domain} → v=DMARC1; p=none`
    }
  ];
  return checks;
}
