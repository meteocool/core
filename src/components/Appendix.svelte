<script>
import { faGithub } from "@fortawesome/free-brands-svg-icons/faGithub";
import Icon from "fa-svelte";

function init() {

}
</script>

<style>
    .appstoreLogo {
        padding-left: 0px;
        display: inline;
    }

    .appstore-logo{
        margin-left: 3px;
        height: 32px;
    }


    :global(.githubIcon) {
        font-size: 30px;
        text-shadow: 3px 3px 0 #ffffff, -1px -1px 0 #ffffff, 1px -1px 0 #ffffff,
        -1px 1px 0 #ffffff, 1px 1px 0 #ffffff;
        color: var(--sl-color-info-700) !important;
        padding: 0;
        border-radius: 0;
        margin: 0.03em 0.2em 0 0.1em;
        vertical-align: top;
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
