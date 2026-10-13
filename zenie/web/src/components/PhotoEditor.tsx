// Editor da foto do equipamento (catálogo de homologação), 100% no navegador, sem bibliotecas:
//  recorte automático das sobras, remoção do fundo por cor (flood fill a partir das bordas, com borda
//  suavizada), enquadramento (zoom, arrastar, margem), giro, cor de fundo e sombra.
// Saída: quadrado de 512 px em WebP (com transparência) de no máximo 200 KB.

import { Crosshair, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Switch } from "./ui";

const OUT = 512; // lado da imagem final
const WORK = 1000; // maior lado durante o processamento
const MAX_BYTES = 200 * 1024;

const BACKGROUNDS = [
  { value: "transparent", label: "Transparente" },
  { value: "#ffffff", label: "Branco" },
  { value: "#f1f5f9", label: "Cinza claro" },
  { value: "#0f172a", label: "Escuro" },
];

interface Settings {
  rotate: number; // 0, 90, 180, 270
  removeBg: boolean;
  tolerance: number; // 0..100
  trim: boolean;
  zoom: number;
  x: number; // deslocamento em px da imagem final
  y: number;
  margin: number; // % de cada lado
  bg: string;
  shadow: boolean;
}

const DEFAULTS: Settings = { rotate: 0, removeBg: false, tolerance: 22, trim: true, zoom: 1, x: 0, y: 0, margin: 8, bg: "#0f172a", shadow: false }; // fundo azul-escuro: padrão das fotos do catálogo

/** Imagem de trabalho: reduzida para no máximo WORK px e girada. */
function baseCanvas(bmp: ImageBitmap, rotate: number): HTMLCanvasElement {
  const s = Math.min(1, WORK / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s);
  const h = Math.round(bmp.height * s);
  const swap = rotate === 90 || rotate === 270;
  const c = document.createElement("canvas");
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
  return c;
}

/** Cor predominante nas bordas (o "fundo" da foto). */
function borderColor(d: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const add = (i: number) => {
    const r = d[i * 4]!, g = d[i * 4 + 1]!, b = d[i * 4 + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    bins.set(key, e);
  };
  for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { add(y * w); add(y * w + w - 1); }
  let best = { n: 0, r: 255, g: 255, b: 255 };
  for (const e of bins.values()) if (e.n > best.n) best = e;
  return best.n ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];
}

/** Remove o fundo (opcional) e corta as sobras (opcional). Devolve o recorte do equipamento. */
function cutout(src: HTMLCanvasElement, removeBg: boolean, tolerance: number, trim: boolean): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const ctx = src.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const [rr, rg, rb] = borderColor(d, w, h);
  const thr = Math.max(4, tolerance * 2.2);
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3]! / 255;
    // pixel já transparente conta como fundo
    dist[i] = a < 0.05 ? 0 : Math.hypot(d[i * 4]! - rr, d[i * 4 + 1]! - rg, d[i * 4 + 2]! - rb);
  }

  const bg = new Uint8Array(w * h);
  if (removeBg) {
    // Flood fill a partir das bordas: só some o fundo ligado à borda (o branco do equipamento fica).
    const stack = new Int32Array(w * h);
    let top = 0;
    const seed = (i: number) => {
      if (!bg[i] && dist[i]! < thr) { bg[i] = 1; stack[top++] = i; }
    };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (top) {
      const i = stack[--top]!;
      const x = i % w;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < w * (h - 1)) seed(i + w);
    }
    for (let i = 0; i < w * h; i++) {
      if (bg[i]) { d[i * 4 + 3] = 0; continue; }
      // Borda suave: pixel vizinho do fundo e com cor parecida fica semitransparente.
      const x = i % w;
      const nearBg = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i < w * (h - 1) && bg[i + w]);
      if (nearBg) {
        const k = Math.min(1, Math.max(0, (dist[i]! - thr) / (thr * 0.6 + 1)));
        d[i * 4 + 3] = Math.round(d[i * 4 + 3]! * (0.35 + 0.65 * k));
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // Caixa do equipamento: pixels que não são fundo.
  let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
  if (trim) {
    const fg = (i: number) => (removeBg ? !bg[i] && d[i * 4 + 3]! > 24 : dist[i]! > Math.max(thr, 18));
    x0 = w; y0 = h; x1 = -1; y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!fg(y * w + x)) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < x0 || y1 < y0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
  }
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Monta a imagem final (OUT x OUT). */
function compose(target: HTMLCanvasElement, cut: HTMLCanvasElement, s: Settings) {
  target.width = OUT;
  target.height = OUT;
  const ctx = target.getContext("2d")!;
  ctx.clearRect(0, 0, OUT, OUT);
  if (s.bg !== "transparent") {
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, OUT, OUT);
  }
  const avail = OUT * (1 - (2 * s.margin) / 100);
  const scale = Math.min(avail / cut.width, avail / cut.height) * s.zoom;
  const dw = cut.width * scale;
  const dh = cut.height * scale;
  ctx.save();
  if (s.shadow) {
    ctx.shadowColor = s.bg === "#0f172a" ? "rgba(0,0,0,0.55)" : "rgba(15,23,42,0.22)";
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 12;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cut, (OUT - dw) / 2 + s.x, (OUT - dh) / 2 + s.y, dw, dh);
  ctx.restore();
}

async function toWebpBase64(c: HTMLCanvasElement): Promise<{ b64: string; kb: number }> {
  for (let q = 0.92; q >= 0.35; q -= 0.08) {
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", q));
    if (!blob || blob.type !== "image/webp") throw new Error("este navegador não gera WebP — use Chrome, Edge ou Firefox");
    if (blob.size <= MAX_BYTES) {
      const url = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(blob);
      });
      return { b64: url.slice(url.indexOf(",") + 1), kb: Math.round(blob.size / 1024) };
    }
  }
  throw new Error("não foi possível reduzir a foto para 200 KB");
}

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="block">
      <span className="flex justify-between text-xs text-muted"><span>{label}</span><span className="font-medium text-ink">{format ? format(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-brand" />
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      {children}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

export function PhotoEditor({ source, onCancel, onSave }: { source: Blob; onCancel: () => void; onSave: (webpBase64: string) => Promise<void> }) {
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const set = (patch: Partial<Settings>) => setS((cur) => ({ ...cur, ...patch }));

  useEffect(() => {
    let alive = true;
    createImageBitmap(source)
      .then((b) => alive && setBmp(b))
      .catch(() => alive && setError("não foi possível abrir esta imagem (use JPG, PNG ou WebP)"));
    return () => {
      alive = false;
    };
  }, [source]);

  // Recalcula o recorte só quando muda giro/fundo/tolerância/corte (zoom e posição são baratos).
  // cutout altera o canvas de trabalho, por isso cada cálculo parte de um canvas novo.
  const cut = useMemo(() => (bmp ? cutout(baseCanvas(bmp, s.rotate), s.removeBg, s.tolerance, s.trim) : null), [bmp, s.rotate, s.removeBg, s.tolerance, s.trim]);

  useEffect(() => {
    if (cut && preview.current) compose(preview.current, cut, s);
  }, [cut, s]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: s.x, y: s.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    const k = OUT / e.currentTarget.getBoundingClientRect().width;
    set({ x: Math.round(drag.current.x + (e.clientX - drag.current.px) * k), y: Math.round(drag.current.y + (e.clientY - drag.current.py) * k) });
  };

  const save = async () => {
    if (!cut) return;
    setSaving(true);
    setError(null);
    try {
      const c = document.createElement("canvas");
      compose(c, cut, s);
      const { b64 } = await toWebpBase64(c);
      await onSave(b64);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao salvar a foto");
      setSaving(false);
    }
  };

  const checker = "bg-[conic-gradient(#e2e8f0_25%,#fff_0_50%,#e2e8f0_0_75%,#fff_0)] bg-[length:20px_20px]";

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
        <div>
          <div className={`mx-auto aspect-square w-full max-w-[420px] overflow-hidden rounded-xl border border-line ${s.bg === "transparent" ? checker : ""}`}>
            {cut ? (
              <canvas
                ref={preview}
                className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
                onWheel={(e) => set({ zoom: Math.min(3, Math.max(0.4, +(s.zoom - Math.sign(e.deltaY) * 0.05).toFixed(2))) })}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted">{error ? "—" : "Carregando a imagem..."}</div>
            )}
          </div>
          <p className="mt-2 text-center text-xs text-muted">Arraste para posicionar · roda do mouse para zoom · resultado: {OUT}×{OUT} px, WebP</p>
        </div>

        <div className="space-y-3">
          <Section title="Fundo da foto">
            <Toggle label="Remover fundo" hint="melhor com fundo liso (parede, papel, mesa)" checked={s.removeBg} onChange={(v) => set({ removeBg: v })} />
            <Slider label="Tolerância" value={s.tolerance} min={2} max={60} step={1} onChange={(v) => set({ tolerance: v })} format={(v) => `${v}`} />
            <Toggle label="Recortar sobras" hint="corta em volta do equipamento" checked={s.trim} onChange={(v) => set({ trim: v })} />
          </Section>

          <Section title="Enquadramento">
            <Slider label="Zoom" value={s.zoom} min={0.4} max={3} step={0.05} onChange={(v) => set({ zoom: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Margem" value={s.margin} min={0} max={25} step={1} onChange={(v) => set({ margin: v })} format={(v) => `${v}%`} />
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1 px-2" title="Girar à esquerda" onClick={() => set({ rotate: (s.rotate + 270) % 360, x: 0, y: 0 })}><RotateCcw size={15} /></Button>
              <Button type="button" variant="secondary" className="flex-1 px-2" title="Girar à direita" onClick={() => set({ rotate: (s.rotate + 90) % 360, x: 0, y: 0 })}><RotateCw size={15} /></Button>
              <Button type="button" variant="secondary" className="flex-1 px-2" title="Centralizar" onClick={() => set({ x: 0, y: 0, zoom: 1 })}><Crosshair size={15} /></Button>
            </div>
          </Section>

          <Section title="Acabamento">
            <div className="flex flex-wrap items-center gap-2">
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  title={b.label}
                  onClick={() => set({ bg: b.value })}
                  className={`h-8 w-8 rounded-full border-2 ${s.bg === b.value ? "border-brand ring-2 ring-brand/20" : "border-line"} ${b.value === "transparent" ? checker : ""}`}
                  style={b.value === "transparent" ? undefined : { background: b.value }}
                />
              ))}
              <label title="Outra cor" className={`relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border-2 ${!BACKGROUNDS.some((b) => b.value === s.bg) ? "border-brand ring-2 ring-brand/20" : "border-line"}`} style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}>
                <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={s.bg.startsWith("#") ? s.bg : "#ffffff"} onChange={(e) => set({ bg: e.target.value })} />
              </label>
            </div>
            <Toggle label="Sombra suave" checked={s.shadow} onChange={(v) => set({ shadow: v })} />
          </Section>

          <button type="button" className="text-xs text-muted hover:text-ink hover:underline" onClick={() => setS(DEFAULTS)}>Desfazer tudo</button>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancelar</Button>
        <Button onClick={() => void save()} disabled={!cut || saving}>{saving ? "Salvando..." : "Usar esta foto"}</Button>
      </div>
    </div>
  );
}
