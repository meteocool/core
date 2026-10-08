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

function run({ modern = true, bitmaps = modern, search = "", languages = ["en-GB"] } = {}) {
  const body = element("body");
  const root = { lang: "" };
  const window: Record<string, unknown> = {
    location: { search },
    matchMedia: () => ({ matches: false }),
  };
  if (bitmaps) window.createImageBitmap = () => undefined;
  const context = vm.createContext({
    window,
    navigator: { languages, language: languages[0] },
    document: { body, documentElement: root, createElement: element },
  });
  if (!modern) {
    // The engine's own String, without the method the check asks after.
    vm.runInContext("delete String.prototype.replaceAll", context);
  }
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
  const page = run({ bitmaps: false });
  assert.equal(page.flagged, true);
  assert.equal(page.notice.attributes.role, "alert");
  assert.match(page.text, /too old for meteocool/i);
  assert.match(page.text, /iOS 15/);
});

test("an engine older than the bundle's syntax is told the same", () => {
  const page = run({ modern: false, bitmaps: true });
  assert.equal(page.flagged, true);
  assert.match(page.text, /too old/i);
});

test("in the reader's language, ?lang= first, as the app chooses it", () => {
  assert.match(run({ bitmaps: false, languages: ["de-AT", "en"] }).text, /zu alt/);
  assert.equal(run({ bitmaps: false, languages: ["de-AT"] }).lang, "de");
  assert.match(run({ bitmaps: false, languages: ["ja", "fr-CA"] }).text, /trop ancien/);
  assert.match(run({ bitmaps: false, search: "?lang=cs", languages: ["de"] }).text, /příliš starý/);
  assert.match(run({ bitmaps: false, languages: ["ja"] }).text, /too old/i);
});
