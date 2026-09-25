<script lang="ts">
import { _ } from "svelte-i18n";
import GlassPanel from "./GlassPanel.svelte";
</script>

<style>
  /* The panel -- material, header, scrolling -- is GlassPanel's, shared with
     Settings and Connection Details; this is the text inside it. */
  .about-text {
    font-size: 14px;
    line-height: 1.5;
  }
  .about-text > :first-child {
    margin-top: 2px;
  }

  h2 {
    font: 600 15px/1.3 var(--mc-font);
    margin: 18px 0 6px;
  }

  a,
  a:visited {
    color: var(--mc-accent);
  }

  .volunteers {
    float: right;
    width: 35%;
    padding: 1em;
    border-radius: var(--mc-radius-inner);
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
          alt="ios app store link"
          class="appstore-logo about" /></a>
      <a href="https://play.google.com/store/apps/details?id=com.meteocool"
        ><img
          class="appstore-logo about"
          alt="google play app store"
          src="assets/google-play-store.png" /></a>
    </div>
    <h2>{$_("features.header")}</h2>
    <ul>
      <li>
        <strong>{$_("features.list_title1")}</strong>
        {$_("features.list1")}
      </li>
      <li>
        <strong>{$_("features.list_title2")}</strong>
        {$_("features.list2")}
      </li>
      <li>
        <strong>{$_("features.list_title3")}</strong>
        {$_("features.list3")}
      </li>
      <li>
        <strong>{$_("features.list_title4")}</strong>
        {$_("features.list4")}
      </li>
    </ul>
    <h2>{$_("credits_help.header")}</h2>
    <p>
      <img
        src="assets/volunteers.png"
        class="volunteers"
        alt="not actually the volunteers" />
    </p>
    <p>
      {@html $_("credits_help.text1")}
    </p>
    <p>
      {@html $_("credits_help.text3")}
    </p>
    <p>
      {@html $_("credits_help.list4.text1")}
      {@html $_("credits_help.list4.text2")}
      {@html $_("credits_help.list4.text3")}
    </p>
    <p>
      {@html $_("credits_help.text4")}
      {@html $_("credits_help.text5")}
    </p>
    <h2>{$_("other_things.header")}</h2>
    <ul>
      <li>{@html $_("other_things.list1")}</li>
      <li>{@html $_("other_things.list2")}</li>
    </ul>
  </div>
</GlassPanel>
