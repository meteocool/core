<script lang="ts">
import { faGithub } from "@fortawesome/free-brands-svg-icons/faGithub";
import Icon from "./Icon.svelte";

function init(_node: HTMLElement) {
  // Placeholder: the element is not used yet.
}
</script>

<style>
    .appstoreLogo {
        display: inline-flex;
        align-items: center;
        padding: 0;
    }

    .appstore-logo {
        margin-left: 4px;
        height: 28px;
        border-radius: 6px;
    }

    :global(.githubIcon) {
        font-size: 24px;
        text-shadow: none;
        color: var(--mc-text-2) !important;
        padding: 0;
        border-radius: 0;
        margin: 0 4px 0 6px;
        vertical-align: middle;
        transition: color var(--mc-motion-fast);
    }
    :global(a:hover > .githubIcon) {
        color: var(--mc-text) !important;
    }
</style>

<div class="app-logos" use:init>
    <div class="appstoreLogo">
        <a
                target="_blank"
                href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623"
        ><img
                src="assets/ios-app-store.png"
                alt="ios app store link"
                class="appstore-logo"
        /></a>
    </div>
    <div class="appstoreLogo">
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
