// Artae: thousands of translucent region fills make panning and zooming crawl, so shaded layers are painted once
// into a bitmap and shown as a single <image>. A data URL, so saved and exported maps keep it
const SCALE = 2; // bitmap pixels per map unit: sharp enough at normal zoom, soft shading hides the rest

export interface RasterShape {
  d?: string; // SVG path data in map units
  color: string;
  opacity: number;
}

/** The shapes as one image covering the map, in the order given */
export function rasterImage(shapes: RasterShape[]): string {
  const { width, height } = options.map.graph;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * SCALE);
  canvas.height = Math.round(height * SCALE);
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.scale(SCALE, SCALE);
  for (const { d, color, opacity } of shapes) {
    if (!d) continue;
    context.globalAlpha = opacity;
    context.fillStyle = color;
    context.fill(new Path2D(d));
  }
  return `<image href="${canvas.toDataURL("image/png")}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" />`;
}
