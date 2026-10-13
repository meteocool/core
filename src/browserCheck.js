/*
 * Whether this browser can run the app at all, asked before the bundle loads.
 *
 * Inline at the top of each app page's body (vite.config.ts puts it there)
 * and in ES5 on purpose: it is for exactly the browsers the bundle fails in,
 * often before a line of the app's own code has run. Two things decide it:
 *
 * - createImageBitmap, which decodes every radar tile in a browser too old to
 *   inflate one itself (lib/valuePng.ts), and hands the 3D map its tiles.
 *   Without it the map came up with no rain on it: Safari and iOS before 15.
 * - What the bundle calls without asking first: the 3D map (MapLibre) uses
 *   Object.hasOwn and Array#at, a cell's lineage graph structuredClone. All three came in Chrome 98, Firefox 94 and Safari 15.4
 *   or earlier, after the 2020 syntax the bundle is built to. An Android
 *   WebView 91 got past the old test (String#replaceAll) and threw on every
 *   frame of the map.
 *
 * Lacking either, the page says so, and `window.mcUnsupported` tells the entry
 * points to start nothing behind it (lib/browserSupport.ts). The strings live
 * here rather than in src/locale, whose catalogues are chunks of the bundle;
 * the language is picked as locale/choose.ts picks it, `?lang=` first.
 */
(function () {
  if (typeof window.createImageBitmap === "function"
    && typeof Object.hasOwn === "function"
    && typeof [].at === "function"
    && typeof window.structuredClone === "function") return;
  window.mcUnsupported = true;

  var MESSAGES = {
    en: [
      "This Browser Is Too Old for meteocool",
      "It cannot draw the rain radar. Please update it. On an iPhone or iPad, meteocool needs iOS 15.4 or later.",
    ],
    de: [
      "Dieser Browser ist zu alt für meteocool",
      "Er kann das Regenradar nicht anzeigen. Bitte aktualisiere ihn. Auf iPhone und iPad braucht meteocool iOS 15.4 oder neuer.",
    ],
    fr: [
      "Ce navigateur est trop ancien pour meteocool",
      "Il ne peut pas afficher le radar de pluie. Veuillez le mettre à jour. Sur iPhone et iPad, meteocool nécessite iOS 15.4 ou ultérieur.",
    ],
    pl: [
      "Ta przeglądarka jest zbyt stara dla meteocool",
      "Nie może wyświetlić radaru opadów. Zaktualizuj ją. Na iPhonie i iPadzie meteocool wymaga iOS 15.4 lub nowszego.",
    ],
    nl: [
      "Deze browser is te oud voor meteocool",
      "Hij kan de regenradar niet tonen. Werk hem bij. Op een iPhone of iPad heeft meteocool iOS 15.4 of nieuwer nodig.",
    ],
    cs: [
      "Tento prohlížeč je pro meteocool příliš starý",
      "Neumí zobrazit srážkový radar. Aktualizuj ho. Na iPhonu a iPadu potřebuje meteocool iOS 15.4 nebo novější.",
    ],
    sk: [
      "Tento prehliadač je pre meteocool príliš starý",
      "Nedokáže zobraziť zrážkový radar. Aktualizuj ho. Na iPhone a iPade potrebuje meteocool iOS 15.4 alebo novší.",
    ],
  };

  var wanted = [];
  var match = /[?&]lang=([^&#]*)/.exec(window.location.search);
  if (match) wanted.push(decodeURIComponent(match[1]));
  wanted = wanted.concat(navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]);
  var lang = "en";
  for (var i = 0; i < wanted.length; i += 1) {
    var tag = String(wanted[i] || "").toLowerCase().split(/[-_]/)[0];
    if (Object.prototype.hasOwnProperty.call(MESSAGES, tag)) {
      lang = tag;
      break;
    }
  }
  var text = MESSAGES[lang];
  document.documentElement.lang = lang;

  // The page's own colours (glass.css), which are not loaded yet and may never be.
  var dark = Boolean(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var notice = document.createElement("div");
  notice.setAttribute("role", "alert");
  notice.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;"
    + "display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;text-align:center;"
    + "font:16px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;"
    + (dark ? "background:#1c1f24;color:#f2f2f7;" : "background:#f6f4f0;color:#1c1c1e;");
  var body = document.createElement("div");
  body.style.cssText = "max-width:26em;";
  var heading = document.createElement("h1");
  heading.style.cssText = "font-size:20px;line-height:1.3;margin:0 0 8px;";
  heading.textContent = text[0];
  var reason = document.createElement("p");
  reason.style.cssText = "margin:0;";
  reason.textContent = text[1];
  body.appendChild(heading);
  body.appendChild(reason);
  notice.appendChild(body);
  document.body.appendChild(notice);
})();
