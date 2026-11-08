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
 * A link at the foot opens "How the radar works", which says what all of
 * these radars do.
 */
import { createEventDispatcher } from "svelte";
import { _, locale } from "svelte-i18n";
import GlassPanel from "./GlassPanel.svelte";
import { radarSite } from "../lib/radarSites";
import { infoText, type RadarInfo } from "../lib/radarInfo";

export let code: string;
export let info: RadarInfo | null;

const dispatch = createEventDispatcher<{ close: void; explain: void }>();

$: site = radarSite(code);
$: name = site?.name ?? code.toUpperCase();
$: text = info ? infoText(info, $locale) : null;
$: num = (value: number, digits = 0) => value.toLocaleString($locale ?? "en", { maximumFractionDigits: digits });

interface Fact { label: string; value: string }

function factsOf(info: RadarInfo | null, tr: typeof $_, n: typeof num): Fact[] {
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

$: facts = factsOf(info, $_, num);

let photoLoaded = false;
let photoFailed = false;
</script>

<style>
  .info {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 4px;
  }
  figure {
    margin: 0;
  }
  /* Its own shape before it arrives, in the tint the glass's rows take, so
     the reading under it stays where it is. */
  .frame {
    position: relative;
    overflow: hidden;
    border-radius: var(--mc-radius-inner);
    background: var(--mc-tint);
  }
  img {
    display: block;
    width: 100%;
    height: auto;
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
    grid-template-columns: max-content 1fr;
    gap: 6px 14px;
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
  .explain {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--mc-accent);
    font: var(--mc-type-body);
    font-weight: 600;
    cursor: pointer;
  }
  .explain:hover {
    text-decoration: underline;
  }
  .explain:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
    border-radius: 4px;
  }
</style>

<GlassPanel title={$_("site.title", { values: { name } })} on:close>
  <div class="info">
    {#if info?.photo && !photoFailed}
      <figure>
        <div class="frame" style:aspect-ratio="{info.photo.width} / {info.photo.height}">
          <img src={info.photo.src} width={info.photo.width} height={info.photo.height}
            alt={$_("site.info.photo_alt", { values: { name } })} decoding="async"
            class:loaded={photoLoaded} on:load={() => { photoLoaded = true; }} on:error={() => { photoFailed = true; }} />
        </div>
        <figcaption>
          <a href={info.photo.page} target="_blank" rel="noopener noreferrer">{$_("site.info.photo_credit", { values: { author: info.photo.author } })}</a>,
          {#if info.photo.licenceUrl}
            <a href={info.photo.licenceUrl} target="_blank" rel="noopener noreferrer license">{info.photo.licence}</a>
          {:else}
            {info.photo.licence}
          {/if}
        </figcaption>
      </figure>
    {/if}

    {#if text}
      <p>{text}</p>
    {:else}
      <p class="missing">{$_("site.info.none")}</p>
    {/if}

    {#if facts.length}
      <dl>
        {#each facts as fact (fact.label)}
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        {/each}
      </dl>
    {/if}

    <button type="button" class="explain" on:click={() => dispatch("explain")}>{$_("site.info.how")}</button>
  </div>
</GlassPanel>
