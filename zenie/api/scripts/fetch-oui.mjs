// Baixa a lista pública OUI do IEEE para data/oui.csv (usada no build da imagem).
// Falha de rede NÃO quebra o build: o painel só deixa de mostrar o fabricante do aparelho.
import { mkdirSync, writeFileSync } from "node:fs";

const URL = process.env.ZENIE_OUI_URL ?? "https://standards-oui.ieee.org/oui/oui.csv";
try {
  const res = await fetch(URL, { headers: { "User-Agent": "Zenie/0.1 (painel NOC GenieACS)" }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.startsWith("Registry,")) throw new Error("formato inesperado");
  mkdirSync("data", { recursive: true });
  writeFileSync("data/oui.csv", text);
  console.log(`oui.csv: ${text.split("\n").length - 2} fabricantes`);
} catch (e) {
  console.warn(`aviso: lista OUI não baixada (${e.message}); fabricante do aparelho ficará indisponível`);
}
