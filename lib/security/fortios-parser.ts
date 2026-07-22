import { createHash } from "node:crypto";

export const FORTIOS_PARSER_VERSION = "1.0.0";
const MAX_LINE_LENGTH = 256 * 1024;
const MAX_LINES = 1_000_000;

export type FortiOsNode = {
  path: string;
  vdom: string;
  edit: string | null;
  values: Readonly<Record<string, readonly string[]>>;
};

export type ParsedFortiOsConfig = {
  version: string;
  nodes: readonly FortiOsNode[];
  digest: string;
};

export function parseFortiOsConfig(input: string): ParsedFortiOsConfig {
  const lines = input.split(/\r?\n/);
  if (lines.length > MAX_LINES) throw new Error("CONFIG_TOO_LARGE");
  const header = lines.slice(0, 20).find((line) => /^#config-version=FG/i.test(line.trim()));
  const versionMatch = header?.match(/^#config-version=FG[^-]*-([0-9.]+)-/i);
  if (!header || !versionMatch) throw new Error("NOT_FORTIOS_CONFIG");

  const sections: string[] = [];
  const nodes: Array<{ path: string; vdom: string; edit: string | null; values: Record<string, string[]> }> = [];
  let current: (typeof nodes)[number] | null = null;
  let vdom = "global";

  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index];
    if (source.length > MAX_LINE_LENGTH) throw new Error("CONFIG_LINE_TOO_LONG");
    const line = source.trim();
    if (!line || line.startsWith("#")) continue;
    const tokens = tokenizeFortiOsLine(line);
    const command = tokens[0]?.toLowerCase();
    if (command === "config" && tokens.length > 1) {
      sections.push(tokens.slice(1).join(" ").toLowerCase());
      current = null;
      continue;
    }
    if (command === "edit" && sections.length) {
      const edit = tokens.slice(1).join(" ");
      if (sections.join("/") === "vdom") vdom = edit;
      current = { path: sections.join("/"), vdom, edit, values: {} };
      nodes.push(current);
      continue;
    }
    if ((command === "set" || command === "unset") && sections.length) {
      if (!current) {
        current = { path: sections.join("/"), vdom, edit: null, values: {} };
        nodes.push(current);
      }
      const key = tokens[1]?.toLowerCase();
      if (key) current.values[key] = command === "unset" ? [] : tokens.slice(2);
      continue;
    }
    if (command === "next") {
      current = null;
      continue;
    }
    if (command === "end") {
      sections.pop();
      current = null;
      if (!sections.length) vdom = "global";
    }
  }
  if (sections.length) throw new Error("FORTIOS_STRUCTURE_INCOMPLETE");
  return { version: versionMatch[1], nodes, digest: createHash("sha256").update(input).digest("hex") };
}

export function tokenizeFortiOsLine(line: string) {
  const tokens: string[] = [];
  let value = "";
  let quoted = false;
  let escaped = false;
  for (const char of line) {
    if (escaped) { value += char; escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (/\s/.test(char) && !quoted) { if (value) { tokens.push(value); value = ""; } continue; }
    value += char;
  }
  if (escaped) value += "\\";
  if (quoted) throw new Error("FORTIOS_UNTERMINATED_QUOTE");
  if (value) tokens.push(value);
  return tokens;
}
