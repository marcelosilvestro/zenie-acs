// Fabricante do aparelho pelo MAC (lista pública OUI do IEEE, baixada no build da imagem —
// scripts/fetch-oui.mjs). Sem a lista, o painel simplesmente não mostra o fabricante.
// MAC "administrado localmente" (2º dígito 2/6/A/E) = MAC aleatório de privacidade (Android/iOS/Windows):
// não identifica fabricante.

import { existsSync, readFileSync } from "node:fs";

const FILE = process.env.ZENIE_OUI_FILE ?? new URL("../data/oui.csv", import.meta.url).pathname;

let table: Map<string, string> | null = null;

/** Encurta nomes longos: "Samsung Electronics Co.,Ltd" -> "Samsung Electronics". */
function shorten(name: string): string {
  let n = name.replace(/\s+/g, " ").trim();
  n = n.replace(/[,.]?\s*(co\.?,?\s*ltd\.?|corp(oration)?\.?|inc\.?|llc|ltd\.?|limited|gmbh|s\.?a\.?|b\.?v\.?|technolog(y|ies)\s+co\.?)\s*$/i, "");
  n = n.replace(/[,.]?\s*(co\.?,?\s*ltd\.?|inc\.?|ltd\.?|limited)\s*$/i, "");
  n = n.replace(/[,.\s]+$/, "");
  // "zte" -> "ZTE"; "huawei technologies" -> "Huawei technologies"
  if (n === n.toLowerCase()) n = n.length <= 4 ? n.toUpperCase() : n.charAt(0).toUpperCase() + n.slice(1);
  return n.length > 40 ? n.slice(0, 40).trim() + "…" : n;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function load(): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(FILE)) return map;
  const lines = readFileSync(FILE, "utf8").split(/\r?\n/);
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const [registry, assignment, org] = parseCsvLine(line);
    if (registry === "MA-L" && assignment && org) map.set(assignment.toLowerCase(), shorten(org));
  }
  return map;
}

export function ouiSize(): number {
  table ??= load();
  return table.size;
}

/** "Samsung Electronics", "MAC privado (aleatório)" ou null. */
export function vendorOf(mac: string | null | undefined): string | null {
  const hex = String(mac ?? "").replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.length < 6) return null;
  if ("26ae".includes(hex[1]!)) return "MAC privado (aleatório)";
  table ??= load();
  return table.get(hex.slice(0, 6)) ?? null;
}
