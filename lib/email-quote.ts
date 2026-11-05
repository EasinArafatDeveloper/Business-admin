/** Reply text without the quoted original ("On … wrote:" and the "> …" lines under it). */
export function stripQuoted(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const next = (lines[i + 1] ?? "").trim();
    // English and Bangla Gmail, Outlook and Apple Mail reply headers (sometimes wrapped over two lines).
    if (/^On .+wrote:$/i.test(l) || (/^On .+/i.test(l) && /wrote:$/i.test(next) && !l.endsWith("."))) break;
    if (/লিখেছেন:$/.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^_{5,}$/.test(l)) break;
    if (/^From: .+/i.test(l) && out.some((x) => x.trim())) break;
    if (/^>/.test(l)) continue;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

/** "STOP", "Unsubscribe", "remove me" as the whole reply. */
export const isOptOutReply = (text: string) => /^\s*(stop|unsubscribe|remove me|remove|bondho|বন্ধ)\s*[.!]*\s*$/i.test(text.split("\n")[0] ?? "");
