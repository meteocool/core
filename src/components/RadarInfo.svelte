<script lang="ts">
/**
 * One radar, for the reader who asks what it is: its photo, where it stands
 * and what it watches, and the facts of the instrument. Opened from the "i"
 * in the open radar's tray (SiteSweepTray), as a chunk of its own with its
 * country's texts (App.svelte, lib/radarInfoLoad.ts), so none of it is in
 * the first load.
 *
 * The photo is fetched only once this is open, and holds its place while it
 * comes, so the text under it does not jump. Its credit and licence are
 * under it, as the licences ask. The facts the network tables already hold
 * (the antenna's height, how far the lowest tilt reaches) come from
 * lib/radarSites.ts, the rest from the radar's entry; a fact nobody could
 * find is left out.
 *
 * Where the screen has room (a desktop's floating panel), the panel is
 * broad and the facts stand beside the photo; a phone's sheet stacks them.
 * A photo taller than it is wide is held to a height, so the facts and the
 * text are not a scroll away. Under the text are the sources the text and
 * facts were taken from, and a button opens "How the radar works", which
 * says what all of these radars do.
 */
import { createEventDispatcher } from "svelte";
import { _, locale } from "svelte-i18n";
import { faCircleQuestion } from "@fortawesome/free-solid-svg-icons/faCircleQuestion";
import { faChevronRight } from "@fortawesome/free-solid-svg-icons/faChevronRight";
import GlassPanel from "./GlassPanel.svelte";
import Icon from "./Icon.svelte";
import { radarSite } from "../lib/radarSites";
import { infoText, sourceLabels, type RadarInfo } from "../lib/radarInfo";

export let code: string;
export let info: RadarInfo | null;

const dispatch = createEventDispatcher<{ close: void; explain: void }>();

$: site = radarSite(code);
$: name = site?.name ?? code.toUpperCase();
$: text = info ? infoText(info, $locale) : null;
/** Numbers as the reader's language writes them. */
const numIn = (language: string | null | undefined) => (value: number, digits = 0) =>
  value.toLocaleString(language ?? "en", { maximumFractionDigits: digits });
type Num = ReturnType<typeof numIn>;

interface Fact { label: string; value: string }

function factsOf(info: RadarInfo | null, tr: typeof $_, n: Num): Fact[] {
  const facts: Fact[] = [];
  const add = (label: string, value: string | null | undefined) => { if (value) facts.push({ label: tr(label), value }); };
  add("site.info.operator", info?.operator);
  add("site.info.system", info?.system);
  if (info?.band || info?.dualPol != null) {
    const parts = [
      info.band ? tr("site.info.band_value", { values: { band: info.band } }) : null,
      info.dualPol == null ? null : tr(info.dualPol ? "site.info.dual_pol" : "site.info.single_pol"),
    ].filter(Boolean);
    add("site.info.band", parts.join(" · "));
  }
  add("site.info.since", info?.since);
  if (site) add("site.info.antenna", tr("site.info.antenna_value", { values: { height: n(site.heightM) } }));
  if (info?.towerM) add("site.info.tower", tr("site.info.metres", { values: { value: n(info.towerM) } }));
  if (site?.rangeKm) add("site.info.range", tr("site.info.km", { values: { value: n(site.rangeKm) } }));
  return facts;
}

$: facts = factsOf(info, $_, numIn($locale));

let photoLoaded = false;
let photoFailed = false;

$: photo = info?.photo && !photoFailed ? info.photo : null;
interface Source { url: string; label: string }

/** The text's and facts' sources, then where the photo was published, unless that is one of them. */
function sourcesOf(urls: readonly string[], photoPage: string | null, tr: typeof $_): Source[] {
  const listed: Source[] = sourceLabels(urls).map((label, index) => ({ url: urls[index], label }));
  if (photoPage && !urls.includes(photoPage)) {
    listed.push({ url: photoPage, label: tr("site.info.photo_source", { values: { source: sourceLabels([photoPage])[0] } }) });
  }
  return listed;
}

$: sources = sourcesOf(info?.sources ?? [], photo?.page ?? null, $_);
</script>

<style>
  /* Its own width decides the layout, not the screen's: the same panel is a
     phone's sheet and a desktop's floating card. */
  .info {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-bottom: 4px;
  }
  .top {
    display: grid;
    gap: 14px;
  }
  @container (min-width: 600px) {
    .top.with-photo {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      align-items: start;
      gap: 20px;
    }
  }
  figure {
    margin: 0;
    min-width: 0;
  }
  /* Its own shape before it arrives, in the tint the glass's rows take, so
     the reading under it stays where it is. No taller than --photo-max: the
     width follows from the photo's proportions. */
  .frame {
    --photo-max: min(46vh, 24rem);
    position: relative;
    overflow: hidden;
    width: 100%;
    margin-inline: auto;
    border-radius: var(--mc-radius-inner);
    background: var(--mc-tint);
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity var(--mc-motion-fast) ease-out;
  }
  img.loaded {
    opacity: 1;
  }
  figcaption {
    margin-top: 5px;
    color: var(--mc-text-3);
    font: 11px/1.35 var(--mc-font);
    text-align: center;
  }
  figcaption a {
    color: inherit;
  }
  p {
    margin: 0;
    font: var(--mc-type-body);
    line-height: 1.5;
  }
  .missing {
    color: var(--mc-text-2);
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 7px 14px;
    margin: 0;
    font: var(--mc-type-body);
  }
  dt {
    color: var(--mc-text-2);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .sources {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--mc-text-3);
    font: 12px/1.45 var(--mc-font);
  }
  .sources h3 {
    margin: 0;
    font: inherit;
    font-weight: 600;
    color: var(--mc-text-2);
  }
  .sources ul {
    display: contents;
  }
  .sources li {
    list-style: none;
  }
  .sources a {
    color: inherit;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
    text-underline-offset: 2px;
  }
  .sources a:hover {
    color: var(--mc-text);
  }

  /* The way on to what every radar does: a row of its own, like the rows of
     the settings, so it reads as a place to go. */
  .explain {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    box-sizing: border-box;
    padding: 11px 12px;
    border: 0;
    border-radius: var(--mc-radius-inner);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: var(--mc-type-body);
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--mc-motion-fast), transform var(--mc-motion-fast) var(--mc-ease);
  }
  .explain:hover {
    background: var(--mc-tint-hover);
  }
  .explain:active {
    transform: scale(var(--mc-press));
  }
  .explain:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
  }
  .explain .glyph {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--mc-accent);
    color: #fff;
    font-size: 16px;
  }
  .explain .words {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    gap: 1px;
  }
  .explain strong {
    font-weight: 600;
  }
  .explain small {
    color: var(--mc-text-2);
    font-size: 12.5px;
    line-height: 1.35;
  }
  .explain .chevron {
    flex: 0 0 auto;
    color: var(--mc-text-3);
    font-size: 12px;
  }
</style>

<GlassPanel title={$_("site.title", { values: { name } })} broad={Boolean(photo)} on:close>
  <div class="info">
    <div class="top" class:with-photo={Boolean(photo)}>
      {#if photo}
        <figure>
          <div class="frame" style:aspect-ratio="{photo.width} / {photo.height}"
            style:max-width="calc(var(--photo-max) * {photo.width / photo.height})">
            <img src={photo.src} width={photo.width} height={photo.height}
              alt={$_("site.info.photo_alt", { values: { name } })} decoding="async"
              class:loaded={photoLoaded} on:load={() => { photoLoaded = true; }} on:error={() => { photoFailed = true; }} />
          </div>
          <figcaption>
            <a href={photo.page} target="_blank" rel="noopener noreferrer">{$_("site.info.photo_credit", { values: { author: photo.author } })}</a>,
            {#if photo.licenceUrl}
              <a href={photo.licenceUrl} target="_blank" rel="noopener noreferrer license">{photo.licence}</a>
            {:else}
              {photo.licence}
            {/if}
          </figcaption>
        </figure>
      {/if}

      {#if facts.length}
        <dl>
          {#each facts as fact (fact.label)}
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          {/each}
        </dl>
      {/if}
    </div>

    {#if text}
      <p>{text}</p>
    {:else}
      <p class="missing">{$_("site.info.none")}</p>
    {/if}

    {#if sources.length}
      <section class="sources" aria-labelledby="radar-sources">
        <h3 id="radar-sources">{$_("site.info.sources")}</h3>
        <ul>
          {#each sources as source (source.url)}
            <li><a href={source.url} target="_blank" rel="noopener noreferrer" title={source.url}>{source.label}</a></li>
          {/each}
        </ul>
      </section>
    {/if}

    <button type="button" class="explain" on:click={() => dispatch("explain")}>
      <span class="glyph" aria-hidden="true"><Icon icon={faCircleQuestion} /></span>
      <span class="words">
        <strong>{$_("site.info.how")}</strong>
        <small>{$_("site.info.how_sub")}</small>
      </span>
      <span class="chevron" aria-hidden="true"><Icon icon={faChevronRight} /></span>
    </button>
  </div>
</GlassPanel>
