// Artae bridge, dev server side: the Artae repo's maps and canon articles, served to the generator
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, relative, resolve, sep } from "node:path";
import { load as parseYaml } from "js-yaml";
import { marked } from "marked";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { ELEMENTS } from "../src/artae/elements";

const ROOT = resolve(process.env.ARTAE_ROOT ?? fileURLToPath(new URL("../../..", import.meta.url)));
const MAPS = join(ROOT, "map/worlds");
const CANON = join(ROOT, "canon");
const PROFILES = join(ROOT, "map/profiles");

interface Article {
  id: string;
  title: string;
  type: string;
  setting: string;
  status: string;
  path: string;
  summary: string;
  map: string[]; // anchors: "<world>/<layer>#burg:12"
  generate: Record<string, unknown>[]; // lore the generator must honour, per map (see the map skill)
  body: string;
}

const walk = (dir: string, ext: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, ext);
    return entry.name.endsWith(ext) ? [path] : [];
  });

function readArticle(file: string): Article | undefined {
  const text = readFileSync(file, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return undefined;
  const meta = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  if (typeof meta.id !== "string") return undefined;
  const body = match[2];
  const summary = body.match(/^> (.+)$/m)?.[1] ?? "";
  const map = meta.map === undefined ? [] : ([] as unknown[]).concat(meta.map).map(String);
  const field = (name: string) => (typeof meta[name] === "string" ? (meta[name] as string) : "");
  const generate = (meta.generate === undefined ? [] : ([] as unknown[]).concat(meta.generate)).filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null
  );
  return {
    id: meta.id,
    title: field("title") || meta.id,
    type: field("type"),
    setting: field("setting"),
    status: field("status"),
    path: relative(ROOT, file),
    summary,
    map,
    generate,
    body
  };
}

// ARTAE_EXTRA_CANON: an extra folder read as canon, for trying generation with articles that are not canon yet
const EXTRA_CANON = process.env.ARTAE_EXTRA_CANON;

const articles = (): Article[] =>
  [CANON, ...(EXTRA_CANON ? [resolve(EXTRA_CANON)] : [])]
    .flatMap(dir => walk(dir, ".md"))
    .map(readArticle)
    .filter((article): article is Article => !!article);

const list = (value: unknown): string[] => (value === undefined ? [] : ([] as unknown[]).concat(value).map(String));
const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

/** What the canon asks the generator to put on a map: cultures, states and burgs, each tied to its article */
function seedFor(map: string) {
  const known = new Set(ELEMENTS.map(element => element.name));
  const seed = {
    map,
    cultures: [] as unknown[],
    states: [] as unknown[],
    burgs: [] as unknown[],
    institutions: [] as unknown[],
    warnings: [] as string[]
  };
  const checkElements = (id: string, names: string[]) => {
    for (const name of names) if (!known.has(name)) seed.warnings.push(`${id}: unknown element "${name}"`);
    return names.filter(name => known.has(name));
  };
  for (const article of articles())
    for (const entry of article.generate) {
      if (entry.map !== map) continue;
      const base = { id: article.id, title: text(entry.name) ?? article.title };
      if (entry.as === "culture")
        seed.cultures.push({
          ...base,
          elements: checkElements(article.id, list(entry.elements)),
          type: text(entry.type),
          names: list(entry.names)
        });
      else if (entry.as === "state") seed.states.push({ ...base, culture: text(entry.culture) });
      else if (entry.as === "burg")
        seed.burgs.push({
          ...base,
          culture: text(entry.culture),
          capital: entry.capital === true,
          near: checkElements(article.id, list(entry.near))
        });
      else if (entry.as === "institution")
        seed.institutions.push({
          ...base,
          summary: article.summary,
          elements: checkElements(article.id, list(entry.elements)),
          kind: text(entry.kind),
          tint: text(entry.tint)
        });
      else seed.warnings.push(`${article.id}: generate entry needs as: culture | state | burg | institution`);
    }
  return seed;
}

const linkIds = (markdown: string, known: Map<string, Article>) =>
  markdown.replace(/\[\[([a-z0-9-]+)\]\]/g, (_, id: string) => {
    const article = known.get(id);
    return article ? `[${article.title}](/artae/canon/${id})` : `<span class="missing">${id}</span>`;
  });

const PAGE_STYLE = `
  :root { color-scheme: light dark; --bg: #fbfaf7; --fg: #22201c; --muted: #6b665c; --accent: #8a4b14; --line: #e3ded3; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1b1a18; --fg: #ece8df; --muted: #a39d90; --accent: #e0a060; --line: #3a3732; } }
  body { background: var(--bg); color: var(--fg); font: 16px/1.6 Georgia, serif; max-width: 46rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  a { color: var(--accent); } nav { font: 14px system-ui, sans-serif; color: var(--muted); margin-bottom: 1.5rem; }
  blockquote { border-left: 3px solid var(--accent); margin: 1rem 0; padding: .25rem 1rem; color: var(--muted); font-style: italic; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; } td, th { border: 1px solid var(--line); padding: .3rem .5rem; text-align: left; }
  .meta { font: 13px system-ui, sans-serif; color: var(--muted); } .missing { color: var(--muted); text-decoration: line-through; }
  code { font-size: 13px; }`;

function page(title: string, html: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${PAGE_STYLE}</style></head><body>
<nav><a href="/artae/canon">Índice del canon</a> · <a href="/Fantasy-Map-Generator/">Mapa</a></nav>${html}</body></html>`;
}

function renderArticle(article: Article, known: Map<string, Article>): string {
  const anchors = article.map.length
    ? ` · en el mapa: ${article.map.map(anchor => `<a href="/Fantasy-Map-Generator/?artae=${encodeURIComponent(anchor)}">${anchor}</a>`).join(", ")}`
    : "";
  const meta = `<p class="meta">${article.type} · ${article.setting} · ${article.status} · <code>${article.path}</code>${anchors}</p>`;
  return page(article.title, meta + marked.parse(linkIds(article.body, known), { async: false }));
}

/** A map path inside map/worlds, or undefined when it escapes it */
function mapFile(name: string): string | undefined {
  const file = resolve(MAPS, `${decodeURIComponent(name)}.map`);
  return file.startsWith(MAPS + sep) ? file : undefined;
}

const readBody = (req: IncomingMessage) =>
  new Promise<string>((done, fail) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", chunk => (data += chunk));
    req.on("end", () => done(data));
    req.on("error", fail);
  });

function send(res: ServerResponse, status: number, body: string, type = "application/json; charset=utf-8"): void {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.end(body);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (path === "/artae/api/maps" && req.method === "GET") {
    mkdirSync(MAPS, { recursive: true });
    const maps = walk(MAPS, ".map").map(file => ({
      name: relative(MAPS, file).slice(0, -4).split(sep).join("/"),
      updated: statSync(file).mtime.toISOString()
    }));
    send(res, 200, JSON.stringify(maps));
    return true;
  }

  if (path.startsWith("/artae/api/maps/")) {
    const file = mapFile(path.slice("/artae/api/maps/".length).replace(/\.map$/, ""));
    if (!file) return send(res, 400, '{"error":"bad map path"}'), true;
    if (req.method === "GET") {
      try {
        send(res, 200, readFileSync(file, "utf8"), "text/plain; charset=utf-8");
      } catch {
        send(res, 404, '{"error":"no such map"}');
      }
      return true;
    }
    if (req.method === "PUT") {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, await readBody(req));
      send(res, 200, JSON.stringify({ saved: relative(ROOT, file) }));
      return true;
    }
  }

  if (path.startsWith("/artae/api/seed/") && req.method === "GET") {
    const map = decodeURIComponent(path.slice("/artae/api/seed/".length)).replace(/\.map$/, "");
    send(res, 200, JSON.stringify(seedFor(map)));
    return true;
  }

  // a setting's world profile: elements, tints, institution kinds (see src/artae/profile.ts)
  if (path.startsWith("/artae/api/profile/") && req.method === "GET") {
    const setting = decodeURIComponent(path.slice("/artae/api/profile/".length));
    const file = resolve(PROFILES, `${setting}.json`);
    if (!/^[\w-]+$/.test(setting) || !file.startsWith(PROFILES + sep)) return send(res, 400, '{"error":"bad setting"}'), true;
    try {
      send(res, 200, readFileSync(file, "utf8"));
    } catch {
      send(res, 404, '{"error":"no profile"}');
    }
    return true;
  }

  if (path === "/artae/api/canon" && req.method === "GET") {
    send(res, 200, JSON.stringify(articles().map(({ body: _, generate: __, ...rest }) => rest)));
    return true;
  }

  if (path === "/artae/canon" || path === "/artae/canon/") {
    const known = new Map(articles().map(article => [article.id, article]));
    const index = readFileSync(join(CANON, "INDEX.md"), "utf8");
    send(res, 200, page("Canon de Artae", marked.parse(linkIds(index, known), { async: false })), "text/html; charset=utf-8");
    return true;
  }

  if (path.startsWith("/artae/canon/")) {
    const known = new Map(articles().map(article => [article.id, article]));
    const article = known.get(path.slice("/artae/canon/".length));
    if (!article) return send(res, 404, page("No encontrado", "<p>Ese artículo no existe.</p>"), "text/html; charset=utf-8"), true;
    send(res, 200, renderArticle(article, known), "text/html; charset=utf-8");
    return true;
  }

  return false;
}

export const artae = (): Plugin => ({
  name: "artae",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith("/artae/")) return next();
      handle(req, res).then(
        handled => handled || next(),
        error => send(res, 500, JSON.stringify({ error: String(error) }))
      );
    });
  }
});
