<script lang="ts">
import { _ } from "svelte-i18n";
import GlassPanel from "./GlassPanel.svelte";
</script>

<style>
  /* The panel (material, header, scrolling) is GlassPanel's, shared with
     Settings and Connection Details; this is the text inside it. */
  .about-text {
    font-size: 14px;
    line-height: 1.5;
  }
  .about-text > :first-child {
    margin-top: 2px;
  }

  h2 {
    font: var(--mc-type-heading);
    letter-spacing: -0.01em;
    margin: 24px 0 8px;
  }

  a,
  a:visited {
    color: var(--mc-accent);
  }

  .appstore-logo {
    width: 95%;
  }

  .appstoreLogo {
    margin: 1em;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .appstore-logo.about {
    flex: 50%;
  }
</style>

<GlassPanel title={$_("title")} on:close>
  <div class="about-text">
    <span>{$_("text1")}</span>
    <div class="appstoreLogo">
      <a href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623"
        ><img
          src="assets/ios-app-store.png"
          alt={$_("chrome.alt.app_store")}
          class="appstore-logo about" /></a>
      <a href="https://play.google.com/store/apps/details?id=com.meteocool"
        ><img
          class="appstore-logo about"
          alt={$_("chrome.alt.play_store")}
          src="assets/google-play-store.png" /></a>
      <a href="https://f-droid.org/packages/com.meteocool/"
        ><img
          class="appstore-logo about"
          alt={$_("chrome.alt.fdroid")}
          src="assets/fdroid-small.png" /></a>
    </div>
    <h2>{$_("credits_help.header")}</h2>
    <p>
      {@html $_("credits_help.text1")}
    </p>
    <p>
      {@html $_("credits_help.text4")}
    </p>
    <h2>{$_("other_things.header")}</h2>
    <ul>
      <li>{@html $_("other_things.list1")}</li>
      <li>{@html $_("other_things.list2")}</li>
      <li>{@html $_("other_things.list3")}</li>
    </ul>
  </div>
</GlassPanel>
