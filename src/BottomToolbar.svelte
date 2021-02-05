<script>
  import Icon from "fa-svelte";
  import { capDescription, capLastUpdated, colorSchemeLight } from "./stores";
  import { faGithubSquare } from "@fortawesome/free-brands-svg-icons/faGithubSquare";
  import { fly } from "svelte/transition";
  import { cssGetclass } from "./lib/css";
  import { enUS, de } from "date-fns/locale";
  import { formatDistanceToNow } from "date-fns";
  import { _, getLocaleFromNavigator } from "svelte-i18n";

  let dfnLocale;
  if (getLocaleFromNavigator() === "de") {
    dfnLocale = de;
  } else {
    dfnLocale = enUS;
  }

  let target;
  let activeForecastTimeout;
  let iconHTML;
  let baseTime;
  let description;
  let lastUpdated;
  let lastUpdatedStr;
  let slPercent = 75;

  capDescription.subscribe((value) => {
    description = value;
  });

  let updateTimeout = 0;

  let updateTime = () => {
    lastUpdatedStr = Math.abs((lastUpdated - new Date()) / 1000);
    slPercent = 100 - Math.min(((lastUpdatedStr - 120) / 420) * 100, 100);
    lastUpdatedStr = formatDistanceToNow(lastUpdated, {
      locale: dfnLocale,
      addSuffix: true,
    });
    updateTimeout = setTimeout(updateTime, 10000);
  };

  capLastUpdated.subscribe((value) => {
    lastUpdated = value;
    if (updateTimeout > 0) window.clearTimeout(updateTimeout);
    updateTimeout = 0;
    updateTime();
  });

  updateTime();

  function show() {
    cssGetclass(".sl-toast-stack").style.bottom =
      "calc(env(safe-area-inset-bottom) + 42px)";
  }
</script>

<style>
  .bottomToolbar {
    position: absolute;
    bottom: 0;
    left: 0;
    border-top-left-radius: 11px;
    border-top-right-radius: 11px;
    border-top: 1px solid lightgray;
    width: 100%;
    background-color: var(--sl-color-white);
  }

  .lastUpdatedBottom {
    height: 42px;
    bottom: env(safe-area-inset-bottom);
    z-index: 99;
    padding-top: 0.2em;
    padding-bottom: 0.2em;
  }

  .parentz {
    display: flex;
  }

  .left {
    height: 28px;
    text-align: center;
    float: left;
    cursor: pointer;
    text-decoration: underline;
    flex-grow: 0; /* do not grow   - initial value: 0 */
    flex-shrink: 0; /* do not shrink - initial value: 1 */
    flex-basis: 3%;
  }

  .right {
    height: 100%;
    text-align: right;
    white-space: nowrap;
    padding: 0;
    flex-grow: 0; /* do not grow   - initial value: 0 */
    flex-shrink: 0; /* do not shrink - initial value: 1 */
    flex-basis: 10%;
  }
  @media only screen and (max-width: 600px) {
    .right {
      display: none;
    }
  }

  .center {
    flex: auto;
    font-family: Quattrocento;
    padding: 0.5em;
    font-size: 9pt;
    font-style: italic;
    position: relative;
    flex-grow: 1; /* do not grow   - initial value: 0 */
    flex-shrink: 1; /* do not shrink - initial value: 1 */
    flex-basis: 90%;
    text-align: center;
  }

  :global(.githubIcon) {
    font-size: 33.6px;
    text-shadow: 3px 3px 0 #ffffff, -1px -1px 0 #ffffff, 1px -1px 0 #ffffff,
      -1px 1px 0 #ffffff, 1px 1px 0 #ffffff;
    color: var(--sl-color-black) !important;
    padding: 0;
    border-radius: 0;
    margin: 6.5px 0.2em 0 0;
    vertical-align: top;
  }

  .appstoreLogo {
    padding-left: 0px;
    display: inline;
  }

  .appstore-logo{
    margin-top: 8px;
    margin-left: 3px;
  }
</style>

<link
  rel="stylesheet"
  type="text/css"
  href="//fonts.googleapis.com/css?family=Quattrocento" />
<div
  class="bottomToolbar lastUpdatedBottom"
  transition:fly={{ y: 100, duration: 200 }}>
  <div class="parentz">
    <div class="left">
      <!-- empty -->
    </div>
    <div class="center">
      <sl-tag
        type="info"
        style="text-indent: unset; font-style: normal; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen-Sans, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif;"
        size="medium"
        pill>
        <sl-progress-ring
          percentage={slPercent}
          size="16"
          stroke-width="1"
          style="--indicator-color: rgb(52,120,246); position: relative; top: 3px; transform: scaleX(-1);" />
        {$_("last_updated")}
        {lastUpdatedStr}
      </sl-tag>
    </div>
    {#if device !== "ios" && device !== "android"}
      <div class="right">
        <div class="appstoreLogo">
          <a
            target="_blank"
            href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623"
            ><img
              src="assets/ios-app-store.png"
              alt="ios app store link"
              class="appstore-logo"
              style="height: 30px;" /></a>
        </div>
        <div class="appstoreLogo">
          <a
            target="_blank"
            href="https://play.google.com/store/apps/details?id=com.meteocool"
            ><img
              class="appstore-logo"
              alt="google play app store"
              src="assets/google-play-store.png"
              style="height: 30px;" /></a>
        </div>
        <div class="appstoreLogo">
          <a target="_blank" href="https://github.com/meteocool/core#meteocool"
            ><Icon icon={faGithubSquare} class="githubIcon" /></a>
        </div>
      </div>
    {/if}
  </div>
</div>
