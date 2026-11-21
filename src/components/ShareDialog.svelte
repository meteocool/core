<script lang="ts">
/**
 * "Send this map to someone": the link, the card it will unfurl as, and
 * where to post it.
 *
 * Opened by lib/share.ts, which has already put the link on the clipboard by
 * the time this is on screen; the field shows it selected, so it can be read
 * and copied again by hand where the clipboard was refused.
 *
 * The card is drawn for the link on request, which takes a few seconds the
 * first time a view is asked for. It is asked for as the dialog opens and the
 * wait is shown in its place. It is the card the link previews as in a
 * messenger (lib/sharePreview.ts), so the sender sees what the receiver will.
 *
 * Instagram takes pictures rather than links: the card goes to it through the
 * platform's share sheet where that takes files (phones), and is saved
 * otherwise, with the link left on the clipboard for the caption.
 */
import { onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons/faWhatsapp";
import { faTelegram } from "@fortawesome/free-brands-svg-icons/faTelegram";
import { faInstagram } from "@fortawesome/free-brands-svg-icons/faInstagram";
import { faFacebookF } from "@fortawesome/free-brands-svg-icons/faFacebookF";
import { faXTwitter } from "@fortawesome/free-brands-svg-icons/faXTwitter";
import { faBluesky } from "@fortawesome/free-brands-svg-icons/faBluesky";
import { faEnvelope } from "@fortawesome/free-solid-svg-icons/faEnvelope";
import { faDownload } from "@fortawesome/free-solid-svg-icons/faDownload";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons/faEllipsis";
import { faCheck } from "@fortawesome/free-solid-svg-icons/faCheck";
import { faCopy } from "@fortawesome/free-solid-svg-icons/faCopy";
import GlassPanel from "./GlassPanel.svelte";
import Icon from "./Icon.svelte";
import { copyLink } from "../lib/share";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, previewPathFor } from "../lib/sharePreview";
import { targetUrl, type ShareTarget } from "../lib/shareTargets";

export let url: string;
export let title: string;
/** Whether lib/share.ts got the link onto the clipboard as the dialog opened. */
export let copied: Promise<boolean>;
/** Whether the link unfurls as the map's card: not a flight's, which has no card to show, send or save. */
export let card = true;
/** What the link carries, where that is not plain: a flight's start, and not its weather. */
export let note: string | undefined = undefined;

/**
 * How long the card may take before the wait is given up. A cold render is a
 * few seconds; one stuck behind a slow backend is not worth sitting in front
 * of, and the link goes out fine without it.
 */
const PREVIEW_TIMEOUT_MS = 45_000;

const FILE_NAME = "meteocool.png";

const SERVICES: { target: ShareTarget; label: string; icon: unknown; brand: string }[] = [
  { target: "whatsapp", label: "WhatsApp", icon: faWhatsapp, brand: "whatsapp" },
  { target: "telegram", label: "Telegram", icon: faTelegram, brand: "telegram" },
  { target: "facebook", label: "Facebook", icon: faFacebookF, brand: "facebook" },
  { target: "x", label: "X", icon: faXTwitter, brand: "x" },
  { target: "bluesky", label: "Bluesky", icon: faBluesky, brand: "bluesky" },
];

let field: HTMLInputElement;
let linkCopied: boolean | null = null;
let copyFailed = false;
let notice: string | null = null;

let preview: "loading" | "ready" | "failed" = "loading";
let previewUrl: string | null = null;
let previewFile: File | null = null;
let shown = false;
let controller: AbortController | null = null;

/** The platform's own share sheet, where the browser has one. */
const sheet = typeof navigator.share === "function";

/** Whether the share sheet takes `data`; the files a browser cannot share are left out. */
function sheetTakes(data: ShareData): boolean {
  try {
    return typeof navigator.canShare === "function" && navigator.canShare(data);
  } catch {
    return false;
  }
}

async function loadPreview() {
  controller?.abort();
  const own = new AbortController();
  controller = own;
  preview = "loading";
  shown = false;
  const timer = setTimeout(() => own.abort(), PREVIEW_TIMEOUT_MS);
  try {
    const response = await fetch(previewPathFor(url), { signal: own.signal });
    if (!response.ok) throw new Error(`preview: ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error(`preview: ${blob.type}`);
    if (own.signal.aborted) return;
    release();
    previewFile = new File([blob], FILE_NAME, { type: blob.type });
    previewUrl = URL.createObjectURL(blob);
    preview = "ready";
  } catch {
    // Closed meanwhile: nothing is waiting for it.
    if (controller !== own) return;
    preview = "failed";
  } finally {
    clearTimeout(timer);
  }
}

function release() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  previewFile = null;
}

async function copy() {
  field?.select();
  // The old way, from the selected field, where the Clipboard API is refused
  // (a browser that asks, or a frame without the permission).
  const ok = await copyLink(url) || copySelection();
  linkCopied = ok;
  copyFailed = !ok;
}

function copySelection(): boolean {
  try {
    field?.select();
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

function saveImage() {
  if (!previewUrl) return;
  const anchor = document.createElement("a");
  anchor.href = previewUrl;
  anchor.download = FILE_NAME;
  anchor.click();
}

async function instagram() {
  if (!previewFile) return;
  notice = null;
  const data: ShareData = { files: [previewFile] };
  if (sheet && sheetTakes(data)) {
    try {
      await navigator.share(data);
    } catch {
      // Closed without picking Instagram, or refused: the dialog is still there.
    }
    return;
  }
  saveImage();
  // Instagram takes the picture; the link goes in by hand, from the clipboard.
  void copyLink(url).then((ok) => { linkCopied ||= ok || copySelection(); });
  notice = $_("share.instagram_saved");
}

async function more() {
  const plain: ShareData = { title, url };
  const withCard: ShareData = previewFile ? { ...plain, files: [previewFile] } : plain;
  try {
    await navigator.share(sheetTakes(withCard) ? withCard : plain);
  } catch {
    // Closed without picking anything: that was the reader's answer.
  }
}

/** Whether there is a keyboard to copy with; on a touch screen focusing the field would only raise one. */
const keyboard = window.matchMedia("(pointer: fine)").matches;

/** The link selected where a keyboard can copy it. */
function preselect(node: HTMLInputElement) {
  if (!keyboard) return;
  // After GlassPanel has put the focus on the panel itself.
  const frame = requestAnimationFrame(() => {
    node.focus({ preventScroll: true });
    node.select();
  });
  return { destroy: () => cancelAnimationFrame(frame) };
}

/* Props are set once: App.svelte keys the dialog by the share that opened it. */
onMount(() => {
  // Refused by the Clipboard API: the old way, from the selected field.
  void copied.then((ok) => { linkCopied ||= ok || (keyboard && copySelection()); });
  if (card) void loadPreview();
});

onDestroy(() => {
  const pending = controller;
  controller = null;
  pending?.abort();
  release();
});
</script>

<GlassPanel title={$_("share.share")} on:close>
  <div class="share">
    {#if card}
    <figure class="card" style="aspect-ratio: {PREVIEW_WIDTH} / {PREVIEW_HEIGHT}" aria-busy={preview === "loading"}>
      {#if preview === "ready" && previewUrl}
        <img src={previewUrl} alt={$_("share.preview_alt")} class:shown
          width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} on:load={() => { shown = true; }} />
      {/if}
      {#if preview === "loading" || (preview === "ready" && !shown)}
        <div class="waiting" role="status">
          <sl-spinner></sl-spinner>
          <span>{$_("share.preview_loading")}</span>
        </div>
      {:else if preview === "failed"}
        <div class="waiting failed" role="status">
          <span>{$_("share.preview_failed")}</span>
          <button type="button" class="retry" on:click={loadPreview}>{$_("share.retry")}</button>
        </div>
      {/if}
    </figure>
    {/if}

    <div class="link">
      <input bind:this={field} use:preselect class="url" type="text" readonly value={url}
        aria-label={$_("share.link")} on:focus={(event) => event.currentTarget.select()} />
      <button type="button" class="copy" class:done={linkCopied} on:click={copy}>
        <Icon icon={linkCopied ? faCheck : faCopy} />
        <span>{linkCopied ? $_("share.copied_short") : $_("share.copy")}</span>
      </button>
    </div>
    {#if note}
      <p class="note">{note}</p>
    {/if}
    <p class="status" aria-live="polite">
      {#if notice}
        {notice}
      {:else if copyFailed}
        {$_("share.copy_failed")}
      {:else if linkCopied}
        {$_("share.copied")}
      {/if}
    </p>

    <ul class="targets">
      {#each SERVICES as service (service.target)}
        <li>
          <a class="target" href={targetUrl(service.target, { url, title })} target="_blank" rel="noopener noreferrer">
            <span class="badge {service.brand}"><Icon icon={service.icon} /></span>
            <span class="name">{service.label}</span>
          </a>
        </li>
      {/each}
      {#if card}
      <li>
        <button type="button" class="target" disabled={preview !== "ready"} on:click={instagram}>
          <span class="badge instagram"><Icon icon={faInstagram} /></span>
          <span class="name">Instagram</span>
        </button>
      </li>
      {/if}
      <li>
        <a class="target" href={targetUrl("email", { url, title })}>
          <span class="badge plain"><Icon icon={faEnvelope} /></span>
          <span class="name">{$_("share.email")}</span>
        </a>
      </li>
      {#if card}
      <li>
        <button type="button" class="target" disabled={preview !== "ready"} on:click={saveImage}>
          <span class="badge plain"><Icon icon={faDownload} /></span>
          <span class="name">{$_("share.save")}</span>
        </button>
      </li>
      {/if}
      {#if sheet}
        <li>
          <button type="button" class="target" on:click={more}>
            <span class="badge plain"><Icon icon={faEllipsis} /></span>
            <span class="name">{$_("share.more")}</span>
          </button>
        </li>
      {/if}
    </ul>
  </div>
</GlassPanel>

<style>
  .share {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* The card, at its own shape whether or not it is there yet, so nothing
     below it moves when it arrives. */
  .card {
    position: relative;
    margin: 0;
    width: 100%;
    border-radius: var(--mc-radius-inner);
    overflow: hidden;
    background: var(--mc-tint);
    box-shadow: inset 0 0 0 1px var(--mc-separator);
  }
  .card img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 240ms var(--mc-ease, ease);
  }
  .card img.shown {
    opacity: 1;
  }

  /* A light passing over the empty card: something is coming, not "nothing here". */
  .card[aria-busy="true"]::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(100deg, transparent 30%, var(--mc-tint-hover) 50%, transparent 70%);
    background-size: 250% 100%;
    animation: sweep 1.6s ease-in-out infinite;
  }
  @keyframes sweep {
    from { background-position: 120% 0; }
    to { background-position: -120% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .card[aria-busy="true"]::before { animation: none; }
  }

  .waiting {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px;
    text-align: center;
    color: var(--mc-text-2);
    font: 500 14px/1.3 var(--mc-font);
  }
  .waiting sl-spinner {
    font-size: 26px;
    --track-width: 3px;
    --indicator-color: var(--mc-accent);
    --track-color: var(--mc-tint-active);
  }
  .retry {
    border: 0;
    border-radius: var(--mc-radius-pill);
    padding: 6px 14px;
    background: var(--mc-tint-hover);
    color: var(--mc-accent);
    font: 600 14px/1.2 var(--mc-font);
    cursor: pointer;
  }

  .link {
    display: flex;
    gap: 8px;
  }
  .url {
    flex: 1 1 auto;
    min-width: 0;
    box-sizing: border-box;
    height: 40px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--mc-radius-inner);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 400 14px/1 var(--mc-font);
    text-overflow: ellipsis;
  }
  .url:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: -2px;
  }
  .url::selection {
    background: color-mix(in srgb, var(--mc-accent) 45%, transparent);
  }
  .copy {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--mc-radius-inner);
    background: var(--mc-accent);
    color: #fff;
    font: 600 14px/1 var(--mc-font);
    cursor: pointer;
    transition: background-color var(--mc-motion-fast);
  }
  .copy.done {
    background: var(--mc-tint-hover);
    color: var(--mc-text);
  }
  .copy.done :global(svg) {
    color: #34c759;
  }

  .note {
    margin: -6px 2px 0;
    color: var(--mc-text-2);
    font: 400 12.5px/1.4 var(--mc-font);
  }
  .status {
    min-height: 1.3em;
    margin: -8px 2px 0;
    color: var(--mc-text-2);
    font: 400 13px/1.3 var(--mc-font);
  }

  .targets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
    gap: 12px 4px;
  }
  .target {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 0;
    border: 0;
    background: transparent;
    color: var(--mc-text);
    font: 500 12px/1.2 var(--mc-font);
    text-decoration: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .target:disabled {
    cursor: progress;
  }
  .target:disabled .badge {
    opacity: 0.4;
  }
  .target:focus-visible {
    outline: none;
  }
  .target:focus-visible .badge {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    color: #fff;
    font-size: 22px;
    transition: transform var(--mc-motion-fast), opacity var(--mc-motion-fast);
  }
  .target:not(:disabled):hover .badge {
    transform: scale(1.06);
  }
  .target:not(:disabled):active .badge {
    transform: scale(0.94);
  }
  .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .whatsapp { background: #25d366; }
  .telegram { background: #229ed9; }
  .facebook { background: #0866ff; }
  .x { background: #000; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18); }
  .bluesky { background: #1185fe; }
  .instagram {
    background: radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285aeb 90%);
  }
  .plain {
    background: var(--mc-tint-hover);
    color: var(--mc-text);
    font-size: 20px;
  }
</style>
