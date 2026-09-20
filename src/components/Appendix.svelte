<script lang="ts">
import { faGithub } from "@fortawesome/free-brands-svg-icons/faGithub";
import Icon from "./Icon.svelte";

function init(_node: HTMLElement) {
  // Placeholder: the element is not used yet.
}
</script>

<style>
    /* The row itself is a flex line, not a line of inline boxes: inline-flex
       items align on the text baseline, which lands the artwork on a shared
       bottom edge with a descender's worth of dead space under it. */
    .app-logos {
        display: flex;
        align-items: center;
    }

    /* Every item is a flex box around a flex link, so each one is exactly as
       tall as its own artwork and gets centred on the same line. Left to the
       inline default, the 28px badges and the 24px mark each sit on their own
       text baseline and the mark ends up ~8px lower than the badges. */
    .appstoreLogo {
        display: inline-flex;
        align-items: center;
        padding: 0;
    }

    .appstoreLogo a {
        display: inline-flex;
        align-items: center;
    }

    .appstore-logo {
        display: block;
        margin-left: 4px;
        height: 28px;
        border-radius: 6px;
    }

    :global(.githubIcon) {
        display: block;
        font-size: 24px;
        text-shadow: none;
        color: var(--mc-text-2) !important;
        padding: 0;
        border-radius: 0;
        margin: 0 4px 0 6px;
        transition: color var(--mc-motion-fast);
    }
    :global(a:hover > .githubIcon) {
        color: var(--mc-text) !important;
    }

    /* The two badges are ~190px of the block's 236px. Below this the tray has
       to truncate "Last updated ..." to fit them, so they go and the repo mark
       -- the one link with nowhere else to live -- stays. BottomToolbar drops
       the whole block at 650px. */
    @media only screen and (max-width: 800px) {
        .appstoreLogo.store-badge {
            display: none;
        }
    }
</style>

<div class="app-logos" use:init>
    <div class="appstoreLogo store-badge">
        <a
                target="_blank"
                href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623"
        ><img
                src="assets/ios-app-store.png"
                alt="ios app store link"
                class="appstore-logo"
        /></a>
    </div>
    <div class="appstoreLogo store-badge">
        <a
                target="_blank"
                href="https://play.google.com/store/apps/details?id=com.meteocool"
        ><img
                class="appstore-logo"
                alt="google play app store"
                src="assets/google-play-store.png"
        /></a>
    </div>
    <div class="appstoreLogo">
        <a target="_blank" href="https://github.com/meteocool/core#meteocool"
        ><Icon icon={faGithub} class="githubIcon" /></a>
    </div>
</div>
