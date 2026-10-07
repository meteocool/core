#!/usr/bin/env node
/**
 * The third-party notices for what the site actually ships.
 *
 *   node scripts/licences.mjs              # builds into a temporary directory first
 *   node scripts/licences.mjs --dist dist  # reads an existing build (needs its source maps)
 *
 * Which packages ship is read from the production build's source maps, not
 * from package.json: a dependency that is tree-shaken away owes no notice,
 * and one pulled in by another (floating-ui by Shoelace, pbf by OpenLayers)
 * does. Prebuilt bundles (MapLibre's dist) carry their own source maps, which
 * are followed too, so what MapLibre bundled inside itself is listed as well.
 *
 * Writes two files, so rerun it after a dependency update:
 *
 * - imprint.html, between the `third-party-licences` markers: the
 *   "Open-source software" section (#software).
 * - public/third-party-licences.json: the same notices for the apps, which
 *   copy it. An array of groups, one per distinct licence text:
 *     { name, version, license, copyright, text,
 *       packages: [{ name, version, copyright }] }
 *   `name` and `version` list the group's packages comma-separated, in the
 *   same order (one version when they all share it); `packages` has them one
 *   by one. `copyright` is the copyright lines taken off the top of each
 *   licence file, one per line (the group's: every distinct one of its
 *   members'); `text` is the licence without them. A full notice is
 *   `copyright + "\n\n" + text`. Copyright lines further down a licence
 *   (MapLibre's repeats those of the code it bundles) stay in `text`, and
 *   one with none at its top (Font Awesome's) has an empty `copyright`.
 *
 * Code and artwork that do not come from npm are listed in EXTRAS.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMPRINT = path.join(root, "imprint.html");
const JSON_OUT = path.join(root, "public/third-party-licences.json");
const START = "<!-- third-party-licences:start -->";
const END = "<!-- third-party-licences:end -->";

const readPackage = (dir) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));

/** Shipped, but not an npm package the source maps could name. */
const EXTRAS = [
  {
    // src/colormaps.ts: the pyart_stepseq, homeyer and lang palettes are
    // Py-ART's StepSeq25, HomeyerRainbow and LangRainbow12.
    name: "Py-ART colour maps",
    version: "",
    license: "BSD-3-Clause",
    text: () => readFileSync(path.join(root, "scripts/licences/pyart.txt"), "utf8"),
  },
  {
    // src/lib/compare/{consensus,models}.ts are ported from it.
    name: "meteocompare",
    version: "",
    license: "MIT",
    text: () => readFileSync(path.join(root, "scripts/licences/meteocompare.txt"), "utf8"),
  },
  {
    // vite.config.ts copies Shoelace's icon set next to the bundle.
    name: "Bootstrap Icons",
    version: `via @shoelace-style/shoelace ${readPackage(path.join(root, "node_modules/@shoelace-style/shoelace")).version}`,
    license: "MIT",
    text: () => readFileSync(path.join(root, "node_modules/@shoelace-style/shoelace/dist/assets/icons/LICENSE"), "utf8"),
  },
  {
    // Vite writes its module-preload helper into the bundle; no source map
    // names it. Only the head of its LICENSE.md is Vite's own; the rest is
    // what Vite's build tooling bundles, none of which ships here.
    name: "vite",
    version: readPackage(path.join(root, "node_modules/vite")).version,
    license: "MIT",
    text: () => {
      const all = readFileSync(path.join(root, "node_modules/vite/LICENSE.md"), "utf8");
      const from = all.indexOf("MIT License");
      const to = all.indexOf("# Licenses of bundled dependencies");
      if (from < 0 || to < from) throw new Error("vite/LICENSE.md changed shape; update EXTRAS");
      return all.slice(from, to);
    },
  },
];

function build() {
  const out = mkdtempSync(path.join(tmpdir(), "meteocool-licences-"));
  const vite = path.join(root, "node_modules/.bin/vite");
  const run = spawnSync(vite, ["build", "--outDir", out, "--emptyOutDir", "--logLevel", "warn"], { cwd: root, stdio: "inherit" });
  if (run.status !== 0) throw new Error("vite build failed");
  return out;
}

function* files(dir, suffix) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(p, suffix);
    else if (p.endsWith(suffix)) yield p;
  }
}

/**
 * The package directory and file a source path in node_modules points at.
 * `relative` starts with "node_modules/" and is relative to `base`. A package
 * hoisted away from where a prebuilt bundle's map expects it is looked up the
 * way Node would, walking up towards the root.
 */
function locate(relative, base) {
  const chain = relative.split("/");
  const last = chain.lastIndexOf("node_modules");
  const nameLength = chain[last + 1].startsWith("@") ? 2 : 1;
  const name = chain.slice(last + 1, last + 1 + nameLength).join("/");
  const rest = chain.slice(last + 1 + nameLength);
  const nested = path.join(base, ...chain.slice(0, last + 1 + nameLength));
  const candidates = [nested];
  for (let dir = base; dir.startsWith(root); dir = path.dirname(dir)) candidates.push(path.join(dir, "node_modules", name));
  const dir = candidates.find((c) => existsSync(path.join(c, "package.json")));
  if (!dir) return { name, dir: null, file: null };
  return { name, dir, file: path.join(dir, ...rest) };
}

/** The package a file inside node_modules belongs to (not a build directory's `{"type": "module"}`). */
function owner(file) {
  for (let dir = path.dirname(file); dir.startsWith(root); dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "package.json")) && readPackage(dir).name) return dir;
  }
  throw new Error(`no package.json above ${file}`);
}

/**
 * Every package whose code is in the build, following dependencies' own
 * source maps. `installed` are package directories; `bundled` are packages a
 * dependency compiled into its own files and that are not installed here,
 * by name, with the dependency that carries them.
 */
function shippedPackages(dist) {
  const installed = new Set();
  const bundled = new Map();
  const seenMaps = new Set();
  const queue = [...files(dist, ".map")];
  while (queue.length) {
    const map = queue.pop();
    if (seenMaps.has(map)) continue;
    seenMaps.add(map);
    const { sources = [], sourceRoot = "" } = JSON.parse(readFileSync(map, "utf8"));
    for (const source of sources) {
      const at = source.indexOf("node_modules/");
      if (at < 0) continue;
      // Vite's maps are relative to the map, except the worker's, which is
      // relative to the project; a dependency's map is relative to itself.
      // Anchor at the directory holding the node_modules the path starts in,
      // or at the project when that does not exist.
      const absolute = path.resolve(path.dirname(map), sourceRoot, source);
      const prefix = absolute.slice(0, absolute.indexOf("/node_modules/"));
      const base = existsSync(path.join(prefix, "node_modules")) ? prefix : root;
      const { name, dir, file } = locate(source.slice(at), base);
      if (dir) {
        installed.add(dir);
        if (existsSync(`${file}.map`)) queue.push(`${file}.map`);
      } else {
        bundled.set(name, owner(map));
      }
    }
  }
  return { installed: [...installed], bundled };
}

const LICENCE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;

/** The licence section of a README, for packages that ship no licence file. */
function readmeLicence(dir) {
  const readme = readdirSync(dir).find((f) => /^readme(\.(md|markdown|txt))?$/i.test(f));
  if (!readme) return null;
  const text = readFileSync(path.join(dir, readme), "utf8");
  const match = text.match(/^#+\s*licen[cs]e\b.*\n([\s\S]*?)(?=^#|(?![\s\S]))/im);
  return match && /permission|redistribution/i.test(match[1]) ? match[1] : null;
}

const spdx = (pkg) => (typeof pkg.license === "string" ? pkg.license
  : (pkg.licenses ?? [pkg.license]).filter(Boolean).map((l) => l.type ?? l).join(" OR "));

function npmEntry(dir) {
  const pkg = readPackage(dir);
  const names = readdirSync(dir).filter((f) => LICENCE_FILE.test(f) && statSync(path.join(dir, f)).isFile());
  let text = names.length ? readFileSync(path.join(dir, names.sort()[0]), "utf8") : readmeLicence(dir);
  if (!text) return { name: pkg.name, version: pkg.version, missing: true };
  const notice = readdirSync(dir).find((f) => /^notice(\.(md|txt))?$/i.test(f));
  if (notice) text += `\n\n${readFileSync(path.join(dir, notice), "utf8")}`;
  return { name: pkg.name, version: pkg.version, license: spdx(pkg), text };
}

/**
 * Packages compiled into a dependency's own files and so not installed here:
 * Sentry's replay carries rrweb, its feedback widget Preact. Their texts are
 * kept in scripts/licences/, named after the package.
 */
const BUNDLED_LICENSES = {
  preact: "MIT",
  "@sentry-internal/rrweb": "MIT",
  "@sentry-internal/rrweb-snapshot": "MIT",
};

function bundledEntry(name, carrier) {
  const pkg = readPackage(carrier);
  const file = path.join(root, "scripts/licences", `${name.replace(/^@/, "").replace("/", "-")}.txt`);
  if (!(name in BUNDLED_LICENSES) || !existsSync(file)) {
    return { name: `${name} (inside ${pkg.name})`, version: "", missing: true };
  }
  const range = { ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.dependencies }[name] ?? "";
  return {
    name,
    version: `${range} in ${pkg.name} ${pkg.version}`.trim(),
    license: BUNDLED_LICENSES[name],
    text: readFileSync(file, "utf8"),
  };
}

const TITLE = /^[\s#(]*(the\s+)?(mit|isc|0bsd|bsd[\w\s-]*|apache[\w\s.-]*)\s*(licen[cs]e)?\s*(\((mit|isc)\))?\)?\s*$/i;
const COPYRIGHT = /^\s*(copyright\b|\(c\)\s|©)/i;
const RESERVED = /^\s*all rights reserved\.?\s*$/i;

/**
 * Splits the copyright lines off the top of a licence, so that licences that
 * differ only in them can share one text. Only a header of titles and
 * standalone copyright lines is taken: a copyright line running on into the
 * licence (Py-ART's second one), or one further down (MapLibre's bundled
 * code), stays where it is.
 */
export function splitCopyright(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const copyright = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || TITLE.test(line)) continue;
    if (RESERVED.test(line) && copyright.length) {
      copyright[copyright.length - 1] += ` ${line.trim()}`;
      continue;
    }
    const next = lines[i + 1] ?? "";
    if (COPYRIGHT.test(line) && (!next.trim() || COPYRIGHT.test(next) || RESERVED.test(next))) {
      copyright.push(line.trim());
      continue;
    }
    break;
  }
  return { copyright, body: lines.slice(i).join("\n").trim() };
}

const normalise = (text) => text.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

const byName = (a, b) => a.localeCompare(b, "en");

export function group(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const { copyright, body } = splitCopyright(entry.text);
    const key = normalise(body);
    const found = groups.get(key) ?? { members: [] };
    found.members.push({ name: entry.name, version: entry.version, license: entry.license, copyright: copyright.join("\n"), body });
    groups.set(key, found);
  }
  return [...groups.values()]
    .map((g) => {
      const members = g.members.sort((a, b) => byName(a.name, b.name) || byName(a.version, b.version));
      const versions = [...new Set(members.map((m) => m.version))];
      const copyright = [...new Set(members.flatMap((m) => (m.copyright ? m.copyright.split("\n") : [])))];
      return {
        name: members.map((m) => m.name).join(", "),
        version: versions.length === 1 ? versions[0] : members.map((m) => m.version).join(", "),
        license: [...new Set(members.map((m) => m.license).filter(Boolean))].join(" / "),
        copyright: copyright.join("\n"),
        text: members[0].body,
        packages: members.map(({ name, version, copyright }) => ({ name, version, copyright })),
      };
    })
    .sort((a, b) => byName(a.name, b.name));
}

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function html(groups) {
  const out = [START];
  for (const g of groups) {
    out.push("    <li>");
    out.push(`      <strong>${escape(g.license)}</strong>`);
    out.push("      <ul>");
    for (const p of g.packages) {
      const label = escape(p.version ? `${p.name} ${p.version}` : p.name);
      const copyright = p.copyright ? ` &ndash; ${p.copyright.split("\n").map(escape).join("; ")}` : "";
      out.push(`        <li>${label}${copyright}</li>`);
    }
    out.push("      </ul>");
    out.push("      <details>");
    out.push("        <summary>Licence text</summary>");
    out.push(`        <pre>${escape(g.text)}</pre>`);
    out.push("      </details>");
    out.push("    </li>");
  }
  out.push(`    ${END}`);
  return out.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const given = args.indexOf("--dist");
  const dist = given >= 0 ? path.resolve(args[given + 1]) : build();
  try {
    const { installed, bundled } = shippedPackages(dist);
    const entries = [
      ...installed.map(npmEntry),
      ...[...bundled].map(([name, carrier]) => bundledEntry(name, carrier)),
    ];
    const missing = entries.filter((e) => e.missing);
    if (missing.length) {
      throw new Error(`no licence text for ${missing.map((e) => `${e.name} ${e.version}`).join(", ")}; `
        + "put it in scripts/licences/ and BUNDLED_LICENSES, or in EXTRAS");
    }
    // One entry per name: a package installed twice in two versions keeps both.
    const unique = new Map(entries.map((e) => [`${e.name}@${e.version}`, e]));
    const extras = EXTRAS.map((e) => ({ ...e, text: e.text() }));
    const groups = group([...unique.values(), ...extras]);

    writeFileSync(JSON_OUT, `${JSON.stringify(groups, null, 2)}\n`);
    const imprint = readFileSync(IMPRINT, "utf8");
    const from = imprint.indexOf(START);
    const to = imprint.indexOf(END);
    if (from < 0 || to < from) throw new Error(`imprint.html lacks the ${START} … ${END} markers`);
    writeFileSync(IMPRINT, imprint.slice(0, from) + html(groups) + imprint.slice(to + END.length));
    console.log(`${unique.size} packages and ${extras.length} others in ${groups.length} licence texts`);
  } finally {
    if (given < 0) rmSync(dist, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
