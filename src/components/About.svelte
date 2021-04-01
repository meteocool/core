<script>
import { _ } from "svelte-i18n";
import { createEventDispatcher } from "svelte";

const dispatch = createEventDispatcher();

function init(elem) {
  elem.addEventListener("sl-overlay-dismiss", (event) => {
    dispatch("close");
    return event.preventDefault();
  });
  elem.show();
}

function close() {
  dispatch("close");
}
</script>

<style>
  :global(.dialog-overview::part(base)) {
    bottom: 7%;
    color: var(--sl-color-gray-700);
  }

  .volunteers {
    float: right;
    width: 35%;
    padding: 1em;
  }

  a {
    color: var(--sl-color-primary-600);
  }

  a:visited {
    color: var(--sl-color-primary-600);
  }

  .appstore-logo {
    width: 95%;
  }

  .appstoreLogo {
    margin: 1em;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .appstore-logo.about {
    flex: 50%;
  }

  .dialog-overview {
    line-height: 1.5em;
  }
</style>

<sl-dialog label={$_("title")} class="dialog-overview" use:init>
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
  <sl-button slot="footer" type="primary" on:click={close}
    >{$_("close")}</sl-button>
</sl-dialog>
