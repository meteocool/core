<script lang="ts" module>
/*
 * The session: the stack's order and who has been swiped, kept for as long
 * as the page is, so closing the screen and opening it again carries on
 * where it left off rather than dealing the same radars again.
 */
let sessionOrder: string[] | null = null;
let sessionSwiped: ReadonlySet<string> = new Set();
</script>

<script lang="ts">
/**
 * "meet you cool": meteocool's radars as profiles to swipe, for fun. Each
 * card is one radar: its photo, name, country and age, its facts as chips,
 * and its description as the bio. Right is a like, left a nope, by dragging
 * the card, by the two buttons under it, or by the arrow keys. A like is
 * sometimes a match (lib/meetYouCool.ts), and a match always waits for the
 * radar to write first, which it never does.
 *
 * Opened only from `#meetyoucool`, as a chunk of its own
 * with every country's texts (App.svelte), so none of it is in the first
 * load. The matches are kept in this browser's localStorage and nowhere else.
 *
 * The texts and facts are read from the radars' entries (lib/radarInfo.ts),
 * never copied, and a photo shown carries its credit and licence, as on the
 * radar's own page (RadarInfo.svelte).
 *
 * A phone gets the whole screen and the matches as a strip above the stack;
 * a desktop a panel over the map with the matches beside it. With reduced
 * motion the card still follows the pointer, but does not lean, fly off or
 * spring back.
 */
import { createEventDispatcher, onMount } from "svelte";
import { _, locale } from "svelte-i18n";
import CloseDisc from "./CloseDisc.svelte";
import Flag from "./Flag.svelte";
import logo from "../assets/logo.svg";
import { countryOf, radarSite } from "../lib/radarSites";
import { infoText, type RadarInfo, type RadarInfoFile } from "../lib/radarInfo";
import {
  ageOf, dealt, isMatch, readMatches, shuffled, tagsOf, tiltOf, upcoming, verdictOf, withMatch, writeMatches,
  type Match, type Verdict,
} from "../lib/meetYouCool";
import { holdNativeChrome } from "../lib/nativeBridge";

/** Every radar's entry, by node code (lib/radarInfoLoad.ts). */
export let radars: RadarInfoFile;

const dispatch = createEventDispatcher<{ close: void }>();
const titleId = "meet-you-cool-title";

/** The radars dealt: those on the map with a photo. */
const codes = dealt(radars, (code) => Boolean(radarSite(code)));
if (!sessionOrder || sessionOrder.length !== codes.length) {
  sessionOrder = shuffled(codes);
  sessionSwiped = new Set();
}
let order: string[] = sessionOrder;
let swiped = sessionSwiped;

/** The top card and the two under it, which are drawn so the next photo is in before it is needed. */
$: stack = upcoming(order, swiped, 3);
$: top = stack[0] ?? null;

const storage = () => window.localStorage;
const known = (code: string) => code in radars && Boolean(radarSite(code));
let matches: Match[] = readMatches(storage, known);

type Screen = { kind: "swipe" } | { kind: "match"; code: string } | { kind: "waiting"; code: string };
let screen: Screen = { kind: "swipe" };

/** What a screen reader is told after a swipe. */
let announcement = "";

const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
const still = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const year = new Date().getFullYear();
const num = (language: string | null | undefined) => (value: number) =>
  value.toLocaleString(language ?? "en", { maximumFractionDigits: 0 });

/** The country's name in the reader's language, or its code where the browser has none. */
function countryName(code: string, language: string | null | undefined): string {
  const country = countryOf(code).toUpperCase();
  try {
    return new Intl.DisplayNames([language ?? "en"], { type: "region" }).of(country) ?? country;
  } catch {
    return country;
  }
}

const nameOf = (code: string) => radarSite(code)?.name ?? code.toUpperCase();

// --- the drag --------------------------------------------------------------

let deck: HTMLElement;
let dx = 0;
let dy = 0;
let dragging = false;
let pointer: number | null = null;
let startX = 0;
let startY = 0;
let lastX = 0;
let lastT = 0;
/** px/ms along x, over the last move: what tells a flick from a drag. */
let speed = 0;
/** The card on its way off, and which way; nothing can be swiped till it has gone. */
let leaving: Verdict | null = null;

/** How long a card takes to fly off. */
const FLING_MS = 240;

const width = () => deck?.clientWidth || 360;

function onPointerDown(event: PointerEvent) {
  if (leaving || pointer !== null) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  // The photo's credit links are for following, not for dragging the card by.
  if ((event.target as Element).closest("a, button")) return;
  pointer = event.pointerId;
  startX = lastX = event.clientX;
  startY = event.clientY;
  lastT = event.timeStamp;
  speed = 0;
  dragging = true;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!dragging || event.pointerId !== pointer) return;
  const dt = event.timeStamp - lastT;
  if (dt > 0) speed = (event.clientX - lastX) / dt;
  lastX = event.clientX;
  lastT = event.timeStamp;
  dx = event.clientX - startX;
  // A little of the vertical, so the card is held rather than on a rail.
  dy = (event.clientY - startY) * 0.25;
}

function onPointerUp(event: PointerEvent) {
  if (!dragging || event.pointerId !== pointer) return;
  dragging = false;
  pointer = null;
  // A pause before letting go is no flick.
  if (event.timeStamp - lastT > 80) speed = 0;
  const verdict = verdictOf(dx, width(), speed);
  if (verdict) swipe(verdict);
  else settle();
}

/** The page took the gesture (a vertical scroll of the bio): the card goes back. */
function onPointerCancel(event: PointerEvent) {
  if (event.pointerId !== pointer) return;
  dragging = false;
  pointer = null;
  settle();
}

function settle() {
  dx = 0;
  dy = 0;
}

/** Off the top card goes, `verdict`'s way, from a drag, a button or a key. */
function swipe(verdict: Verdict) {
  const code = top;
  if (!code || leaving || screen.kind !== "swipe") return;
  if (still()) {
    settle();
    decide(code, verdict);
    return;
  }
  leaving = verdict;
  const away = (verdict === "like" ? 1 : -1) * (width() * 1.4 + 120);
  dx = away;
  window.setTimeout(() => {
    leaving = null;
    settle();
    decide(code, verdict);
  }, FLING_MS);
}

function decide(code: string, verdict: Verdict) {
  swiped = sessionSwiped = new Set([...swiped, code]);
  announcement = $_(verdict === "like" ? "meet.liked" : "meet.noped", { values: { name: nameOf(code) } });
  if (verdict === "like" && isMatch()) {
    matches = withMatch(matches, code, Date.now());
    writeMatches(storage, matches);
    screen = { kind: "match", code };
  }
}

function startOver() {
  order = sessionOrder = shuffled(codes);
  swiped = sessionSwiped = new Set();
  screen = { kind: "swipe" };
}

const toSwiping = () => { screen = { kind: "swipe" }; };

// --- keys, focus and the apps' chrome ----------------------------------------

let dialog: HTMLElement;

/** Where the keyboard goes when a screen opens. */
function autofocus(node: HTMLElement) {
  node.focus({ preventScroll: true });
}

/*
 * Capture phase, ahead of the map's own keys (the timeline steps on the
 * arrows), which never see the ones taken here.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (screen.kind === "swipe") dispatch("close");
    else toSwiping();
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (!dialog?.contains(event.target as Node) && event.target !== document.body) return;
  event.preventDefault();
  event.stopPropagation();
  if (screen.kind === "swipe") swipe(event.key === "ArrowRight" ? "like" : "nope");
}

onMount(() => {
  window.addEventListener("keydown", onKeydown, true);
  const releaseChrome = holdNativeChrome();
  return () => {
    window.removeEventListener("keydown", onKeydown, true);
    releaseChrome();
  };
});

$: progress = Math.max(-1, Math.min(1, dx / Math.max(1, width() * 0.3)));
$: topStyle = `transform: translate(${dx}px, ${dy}px) rotate(${still() ? 0 : tiltOf(dx, width())}deg)`;

/** Photos that would not load, shown as the placeholder instead. */
let broken: ReadonlySet<string> = new Set();
const photoFailed = (code: string) => { broken = new Set([...broken, code]); };
const photoOf = (info: RadarInfo | undefined, code: string, _broken: ReadonlySet<string>) =>
  (info?.photo && !_broken.has(code) ? info.photo : null);
</script>

{#snippet radome()}
  <!-- A radar's dome on its tower, for the radars nobody has a photo of. -->
  <svg class="radome" viewBox="0 0 48 64" aria-hidden="true">
    <circle cx="24" cy="18" r="15" />
    <path d="M17 33h14l3 27H14z" />
    <path class="seam" d="M9.5 15h29M11 24h26M24 3v30" />
  </svg>
{/snippet}

{#snippet avatar(code: string)}
  {@const photo = photoOf(radars[code], code, broken)}
  <span class="avatar" aria-hidden="true">
    {#if photo}
      <img src={photo.src} alt="" decoding="async" draggable="false" on:error={() => photoFailed(code)} />
    {:else}
      {@render radome()}
    {/if}
  </span>
{/snippet}

<div class="scrim" on:click|self={() => dispatch("close")} role="presentation">
  <div class="panel mc-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabindex="-1"
    bind:this={dialog} use:autofocus>
    <header>
      <img src={logo} alt="" class="logo" />
      <h2 id={titleId}>{$_("meet.title")}</h2>
      <CloseDisc on:click={() => dispatch("close")} />
    </header>

    <section class="matches" class:none={!matches.length} aria-labelledby="meet-you-cool-matches">
      <h3 id="meet-you-cool-matches">
        {$_("meet.matches")} <span class="count mc-num">{matches.length}</span>
      </h3>
      {#if matches.length}
        <ul>
          {#each matches as match (match.code)}
            <li>
              <button type="button" class="match" on:click={() => { screen = { kind: "waiting", code: match.code }; }}>
                {@render avatar(match.code)}
                <span class="match-text">
                  <span class="match-name">{nameOf(match.code)}</span>
                  <span class="match-state">{$_("meet.match_waiting")}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="matches-none">{$_("meet.matches_none")}</p>
      {/if}
    </section>

    <div class="main">
      {#if screen.kind === "match"}
        {@const name = nameOf(screen.code)}
        <div class="moment match-moment" role="group" aria-labelledby="meet-you-cool-moment">
          <div class="pair" aria-hidden="true">
            <span class="avatar big me"><img src={logo} alt="" /></span>
            <span class="heart">♥</span>
            <span class="big-wrap">{@render avatar(screen.code)}</span>
          </div>
          <h3 id="meet-you-cool-moment" class="headline">{$_("meet.match_title")}</h3>
          <p>{$_("meet.match_text", { values: { name } })}</p>
          <div class="actions">
            <button type="button" class="primary" use:autofocus on:click={() => {
              if (screen.kind === "match") screen = { kind: "waiting", code: screen.code };
            }}>{$_("meet.send")}</button>
            <button type="button" class="secondary" on:click={toSwiping}>{$_("meet.keep_swiping")}</button>
          </div>
        </div>
      {:else if screen.kind === "waiting"}
        {@const name = nameOf(screen.code)}
        <div class="moment" role="group" aria-labelledby="meet-you-cool-moment">
          <div class="pair" aria-hidden="true">
            <span class="big-wrap">{@render avatar(screen.code)}</span>
          </div>
          <h3 id="meet-you-cool-moment" class="headline small">{$_("meet.waiting_title", { values: { name } })}</h3>
          <p class="typing" aria-hidden="true"><span></span><span></span><span></span></p>
          <p>{$_("meet.waiting_text", { values: { name } })}</p>
          <div class="actions">
            <button type="button" class="primary" use:autofocus on:click={toSwiping}>{$_("meet.back")}</button>
          </div>
        </div>
      {:else if top}
        <div class="deck" bind:this={deck}>
          {#each [...stack].reverse() as code, i (code)}
            {@const info = radars[code]}
            {@const site = radarSite(code)}
            {@const photo = photoOf(info, code, broken)}
            {@const depth = stack.length - 1 - i}
            {@const age = ageOf(info.since, year)}
            {@const name = nameOf(code)}
            <article
              class="card depth-{depth}"
              class:top={depth === 0}
              class:dragging={depth === 0 && dragging}
              class:leaving={depth === 0 && leaving}
              style={depth === 0 ? topStyle : undefined}
              aria-hidden={depth === 0 ? undefined : "true"}
              aria-label={depth === 0 ? $_("meet.profile", { values: { name } }) : undefined}
              inert={depth !== 0}
              on:pointerdown={depth === 0 ? onPointerDown : undefined}
              on:pointermove={depth === 0 ? onPointerMove : undefined}
              on:pointerup={depth === 0 ? onPointerUp : undefined}
              on:pointercancel={depth === 0 ? onPointerCancel : undefined}>
              <figure class="photo">
                {#if photo}
                  <img src={photo.src} width={photo.width} height={photo.height} draggable="false" decoding="async"
                    alt={$_("site.info.photo_alt", { values: { name } })} on:error={() => photoFailed(code)} />
                  <figcaption>
                    <a href={photo.page} target="_blank" rel="noopener noreferrer">{$_("site.info.photo_credit", { values: { author: photo.author } })}</a>,
                    {#if photo.licenceUrl}
                      <a href={photo.licenceUrl} target="_blank" rel="noopener noreferrer license">{photo.licence}</a>
                    {:else}
                      {photo.licence}
                    {/if}
                  </figcaption>
                {:else}
                  <div class="placeholder">
                    {@render radome()}
                    <span>{$_("meet.no_photo")}</span>
                  </div>
                {/if}
                {#if depth === 0}
                  <span class="stamp like" style:opacity={Math.max(0, progress)} aria-hidden="true">{$_("meet.like")}</span>
                  <span class="stamp nope" style:opacity={Math.max(0, -progress)} aria-hidden="true">{$_("meet.nope")}</span>
                {/if}
              </figure>
              <div class="about">
                <h3 class="name">
                  {#if age == null}
                    {name} <span class="age mystery">{$_("meet.age_unknown")}</span>
                  {:else}
                    {$_("meet.name_age", { values: { name, age } })}
                  {/if}
                </h3>
                <p class="where">
                  <Flag country={countryOf(code)} />
                  <span>{countryName(code, $locale)}</span>
                </p>
                {#if info}
                  {@const tags = tagsOf(info, site, $_, num($locale))}
                  {#if tags.length}
                    <ul class="tags">
                      {#each tags as tag (tag.kind)}
                        <li class="tag tag-{tag.kind}">{tag.text}</li>
                      {/each}
                    </ul>
                  {/if}
                  <p class="bio">{infoText(info, $locale)}</p>
                {/if}
              </div>
            </article>
          {/each}
        </div>
        <div class="buttons">
          <button type="button" class="vote nope" aria-label={$_("meet.nope")} title={$_("meet.nope")}
            disabled={Boolean(leaving)} on:click={() => swipe("nope")}>✕</button>
          <button type="button" class="vote like" aria-label={$_("meet.like")} title={$_("meet.like")}
            disabled={Boolean(leaving)} on:click={() => swipe("like")}>♥</button>
        </div>
        <p class="hint">{$_(touch ? "meet.hint_touch" : "meet.hint_keys")}</p>
      {:else}
        <div class="moment" role="group" aria-labelledby="meet-you-cool-moment">
          <div class="pair" aria-hidden="true"><span class="avatar big">{@render radome()}</span></div>
          <h3 id="meet-you-cool-moment" class="headline small">{$_("meet.empty_title")}</h3>
          <p>{$_("meet.empty_text", { values: { count: codes.length } })}</p>
          <div class="actions">
            <button type="button" class="primary" use:autofocus on:click={startOver}>{$_("meet.start_over")}</button>
          </div>
        </div>
      {/if}
      <p class="sr-only" aria-live="polite">{announcement}</p>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--mc-z-panel);
    display: flex;
    align-items: center;
    justify-content: center;
    padding:
      calc(var(--mc-safe-top) + var(--mc-gutter))
      calc(var(--mc-gutter) + env(safe-area-inset-right, 0px))
      calc(var(--mc-safe-bottom) + var(--mc-gutter))
      calc(var(--mc-gutter) + env(safe-area-inset-left, 0px));
    box-sizing: border-box;
    background: var(--mc-scrim);
  }

  /* A desktop: a panel over the map, the stack and the matches side by side. */
  .panel {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 15rem;
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas: "head head" "main matches";
    width: min(52rem, 100%);
    height: min(46rem, 100%);
    box-sizing: border-box;
    border-radius: var(--mc-radius-tray);
    outline: none;
    overflow: hidden;
  }

  header {
    grid-area: head;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 14px 6px var(--mc-drawer-pad);
  }
  .logo {
    width: 28px;
    height: 28px;
    filter: drop-shadow(0 0.5px 1px rgba(0, 0, 0, 0.28));
  }
  h2 {
    flex: 1 1 auto;
    margin: 0;
    font: var(--mc-type-title);
    letter-spacing: -0.02em;
  }

  .main {
    grid-area: main;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px var(--mc-drawer-pad) 14px;
  }

  /* --- the matches -------------------------------------------------------- */
  .matches {
    grid-area: matches;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 8px 14px 14px 0;
  }
  .matches h3 {
    margin: 4px 4px 8px;
    font: var(--mc-type-heading);
  }
  .count {
    color: var(--mc-text-2);
    font-weight: 500;
  }
  .matches ul {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .match {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px;
    border: 0;
    border-radius: var(--mc-radius-inner);
    background: transparent;
    color: var(--mc-text);
    font: var(--mc-type-body);
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--mc-motion-fast);
  }
  .match:hover { background: var(--mc-tint-hover); }
  .match:active { background: var(--mc-tint-active); }
  .match:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: -2px; }
  .match-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .match-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .match-state {
    color: var(--mc-text-2);
    font: var(--mc-type-label);
    font-weight: 400;
  }
  .matches-none {
    margin: 0 4px;
    color: var(--mc-text-2);
    font: var(--mc-type-body);
  }

  .avatar {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--mc-accent-tint);
    color: var(--mc-accent);
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .avatar .radome {
    width: 60%;
    height: 60%;
  }

  /* --- the stack ---------------------------------------------------------- */
  .deck {
    position: relative;
    flex: 1 1 auto;
    width: 100%;
    max-width: 24rem;
    min-height: 0;
  }
  .card {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    border-radius: var(--mc-radius-card);
    overflow: hidden;
    background: var(--mc-sheet-card);
    color: var(--mc-text);
    box-shadow: 0 0 0 0.5px var(--mc-hairline), var(--mc-glass-shadow);
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    transition: transform var(--mc-motion-spring) var(--mc-ease-spring), opacity var(--mc-motion);
  }
  /* The cards under the top one wait a step back, and step up when it goes. */
  .card.depth-1 { transform: translateY(10px) scale(0.96); }
  .card.depth-2 { transform: translateY(20px) scale(0.92); opacity: 0; }
  .card.top {
    cursor: grab;
    /* The bio scrolls up and down by itself; sideways is the swipe's. */
    touch-action: pan-y;
  }
  .card.dragging {
    cursor: grabbing;
    transition: none;
  }
  .card.leaving {
    transition: transform 240ms ease-in, opacity 240ms ease-in;
    opacity: 0;
  }

  .photo {
    position: relative;
    flex: 0 0 auto;
    height: 52%;
    margin: 0;
    background: var(--mc-tint);
  }
  .photo img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .photo figcaption {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 18px 12px 6px;
    background: linear-gradient(to bottom, transparent, rgba(0, 0, 0, 0.55));
    color: rgba(255, 255, 255, 0.92);
    font: 11px/1.35 var(--mc-font);
    text-align: right;
  }
  .photo figcaption a {
    color: inherit;
  }
  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    background:
      radial-gradient(circle at 50% 120%, var(--mc-accent-tint), transparent 70%),
      linear-gradient(160deg, var(--mc-tint), transparent);
    color: var(--mc-text-3);
    font: var(--mc-type-label);
  }
  .placeholder .radome {
    width: 64px;
    height: 84px;
    color: var(--mc-accent);
    opacity: 0.55;
  }
  .radome {
    fill: currentColor;
  }
  .radome .seam {
    fill: none;
    stroke: var(--mc-sheet-card);
    stroke-width: 1.2;
    opacity: 0.6;
  }

  .stamp {
    position: absolute;
    top: 18px;
    padding: 2px 10px;
    border: 3px solid currentColor;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.75);
    font: 800 26px/1.1 var(--mc-font);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    pointer-events: none;
  }
  .stamp.like {
    left: 16px;
    color: var(--mc-green-ink);
    transform: rotate(-12deg);
  }
  .stamp.nope {
    right: 16px;
    color: var(--mc-red-ink);
    transform: rotate(12deg);
  }

  .about {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px 16px 16px;
  }
  .name {
    margin: 0;
    font: var(--mc-type-title);
    letter-spacing: -0.02em;
  }
  .age.mystery {
    color: var(--mc-text-2);
    font: var(--mc-type-subtitle);
    font-style: italic;
    white-space: nowrap;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0 10px;
    color: var(--mc-text-2);
    font: var(--mc-type-subtitle);
  }
  .where :global(.flag) {
    width: 18px;
    height: 12px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
  }
  .tag {
    padding: 3px 9px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: var(--mc-type-label);
    white-space: nowrap;
  }
  .tag-operator, .tag-band {
    background: var(--mc-accent-tint);
  }
  .bio {
    margin: 0;
    font: var(--mc-type-body);
    line-height: 1.5;
    user-select: text;
    -webkit-user-select: text;
  }

  .buttons {
    flex: none;
    display: flex;
    gap: 28px;
    margin-top: 16px;
  }
  .vote {
    display: grid;
    place-items: center;
    width: 58px;
    height: 58px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--mc-sheet-card);
    box-shadow: 0 0 0 0.5px var(--mc-hairline), var(--mc-glass-shadow-sm);
    font: 600 26px/1 var(--mc-font);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .vote.nope { color: var(--mc-red-ink); }
  .vote.like { color: var(--mc-green-ink); }
  .vote:hover { background: var(--mc-sheet-card-hover); }
  .vote:active { transform: scale(var(--mc-press)); }
  .vote:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 3px; }
  .vote:disabled { cursor: default; }
  .hint {
    flex: none;
    margin: 10px 0 0;
    color: var(--mc-text-3);
    font: var(--mc-type-label);
    font-weight: 400;
    text-align: center;
  }

  /* --- a match, the wait, the end of the stack ------------------------------ */
  .moment {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    max-width: 24rem;
    text-align: center;
  }
  .moment p {
    margin: 0;
    color: var(--mc-text-2);
    font: var(--mc-type-body);
    line-height: 1.5;
  }
  .pair {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .avatar.big,
  .big-wrap .avatar {
    width: 96px;
    height: 96px;
    box-shadow: 0 0 0 3px var(--mc-sheet-card), var(--mc-glass-shadow);
  }
  .avatar.me {
    background: var(--mc-brand);
  }
  .avatar.me img {
    width: 62%;
    height: 62%;
    object-fit: contain;
  }
  .heart {
    color: var(--mc-red);
    font-size: 30px;
  }
  .headline {
    margin: 0;
    font: 800 34px/1.1 var(--mc-font);
    letter-spacing: -0.03em;
    color: var(--mc-accent);
  }
  .headline.small {
    font: var(--mc-type-title);
    color: var(--mc-text);
  }
  .match-moment .pair,
  .match-moment .headline {
    animation: pop var(--mc-motion-spring) var(--mc-ease-spring) both;
  }
  @keyframes pop {
    from { transform: scale(0.6); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
  .typing {
    display: flex;
    gap: 5px;
    padding: 8px 12px;
    border-radius: 16px;
    background: var(--mc-tint);
  }
  .typing span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--mc-text-3);
    animation: typing 1.2s ease-in-out infinite;
  }
  .typing span:nth-child(2) { animation-delay: 0.15s; }
  .typing span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes typing {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
    30% { transform: translateY(-4px); opacity: 1; }
  }
  .actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    width: min(16rem, 100%);
    margin-top: 16px;
  }
  .primary,
  .secondary {
    min-height: 44px;
    padding: 10px 18px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    font: 600 15px/1.2 var(--mc-font);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .primary {
    background: var(--mc-accent);
    color: #fff;
  }
  .secondary {
    background: var(--mc-tint);
    color: var(--mc-text);
  }
  .secondary:hover { background: var(--mc-tint-hover); }
  .primary:active,
  .secondary:active { transform: scale(var(--mc-press)); }
  .primary:focus-visible,
  .secondary:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* A phone: the whole screen, the matches as a strip over the stack, and
     none of it while there are none. */
  @media (max-width: 620px) {
    .scrim {
      padding: 0;
      background: none;
    }
    .panel {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto minmax(0, 1fr);
      grid-template-areas: "head" "matches" "main";
      width: 100%;
      height: 100%;
      border-radius: 0;
      /* The whole screen is this one thing: solid, as a full-screen sheet
         is, rather than glass with the map's chrome showing through. */
      background: var(--mc-sheet);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
      box-shadow: none;
      padding:
        var(--mc-safe-top)
        env(safe-area-inset-right, 0px)
        var(--mc-safe-bottom)
        env(safe-area-inset-left, 0px);
    }
    .matches {
      overflow: visible;
      padding: 0 0 4px;
    }
    .matches.none {
      display: none;
    }
    .matches h3 {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .matches ul {
      flex-direction: row;
      gap: 6px;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      padding: 0 var(--mc-drawer-pad);
      scrollbar-width: none;
    }
    .matches li {
      flex: none;
    }
    .match {
      width: auto;
      max-width: 13rem;
      padding: 4px 10px 4px 4px;
      border-radius: var(--mc-radius-pill);
      background: var(--mc-tint);
    }
    .match .avatar {
      width: 34px;
      height: 34px;
    }
    .match-name,
    .match-state {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .main {
      padding: 6px 14px 10px;
    }
    .buttons {
      margin-top: 12px;
    }
    .hint {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card,
    .card.leaving {
      transition: none;
    }
    .match-moment .pair,
    .match-moment .headline,
    .typing span {
      animation: none;
    }
  }
</style>
