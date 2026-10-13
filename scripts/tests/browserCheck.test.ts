import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

/**
 * The inline check every app page runs before its bundle (src/browserCheck.js).
 *
 * Run as the page runs it, in a context of its own, against just enough of a
 * DOM to see what it puts on the page.
 */

const source = readFileSync(new URL("../../src/browserCheck.js", import.meta.url), "utf8");

interface Element {
  tag: string;
  children: Element[];
  textContent: string;
  attributes: Record<string, string>;
  style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  appendChild(child: Element): Element;
}

function element(tag: string): Element {
  return {
    tag,
    children: [],
    textContent: "",
    attributes: {},
    style: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); return child; },
  };
}

/** What a browser lacks, by the name of the function the check asks after. */
type Missing = "createImageBitmap" | "Object.hasOwn" | "Array#at" | "structuredClone";

function run({ missing = [] as Missing[], search = "", languages = ["en-GB"] } = {}) {
  const body = element("body");
  const root = { lang: "" };
  const window: Record<string, unknown> = {
    location: { search },
    matchMedia: () => ({ matches: false }),
  };
  if (!missing.includes("createImageBitmap")) window.createImageBitmap = () => undefined;
  if (!missing.includes("structuredClone")) window.structuredClone = (value: unknown) => value;
  const context = vm.createContext({
    window,
    navigator: { languages, language: languages[0] },
    document: { body, documentElement: root, createElement: element },
  });
  // The engine's own builtins, without the ones this browser lacks.
  if (missing.includes("Object.hasOwn")) vm.runInContext("delete Object.hasOwn", context);
  if (missing.includes("Array#at")) vm.runInContext("delete Array.prototype.at", context);
  vm.runInContext(source, context);
  const notice = body.children[0];
  const words = (el: Element | undefined): string[] => (el ? [el.textContent, ...el.children.flatMap(words)].filter(Boolean) : []);
  return { flagged: window.mcUnsupported === true, notice, text: words(notice).join(" "), lang: root.lang };
}

test("a current browser is left alone", () => {
  const page = run();
  assert.equal(page.flagged, false);
  assert.equal(page.notice, undefined);
});

test("without createImageBitmap, which every radar tile needs, the page says so", () => {
  const page = run({ missing: ["createImageBitmap"] });
  assert.equal(page.flagged, true);
  assert.equal(page.notice.attributes.role, "alert");
  assert.match(page.text, /too old for meteocool/i);
  assert.match(page.text, /iOS 15\.4/);
});

test("without Object.hasOwn, which the 3D map calls on every frame, the page says so", () => {
  const page = run({ missing: ["Object.hasOwn"] });
  assert.equal(page.flagged, true);
  assert.match(page.text, /too old/i);
});

test("without Array#at, which the 3D map calls, the page says so", () => {
  assert.equal(run({ missing: ["Array#at"] }).flagged, true);
});

test("without structuredClone, which a cell's lineage graph needs, the page says so", () => {
  assert.equal(run({ missing: ["structuredClone"] }).flagged, true);
});

test("in the reader's language, ?lang= first, as the app chooses it", () => {
  const old = (search: string, languages: string[]) => run({ missing: ["Object.hasOwn"], search, languages });
  assert.match(old("", ["de-AT", "en"]).text, /zu alt/);
  assert.equal(old("", ["de-AT"]).lang, "de");
  assert.match(old("", ["ja", "fr-CA"]).text, /trop ancien/);
  assert.match(old("?lang=cs", ["de"]).text, /příliš starý/);
  assert.match(old("", ["ja"]).text, /too old/i);
});
