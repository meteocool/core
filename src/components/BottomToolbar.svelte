<script>
  import Icon from "fa-svelte";
  import { faGithubSquare } from "@fortawesome/free-brands-svg-icons/faGithubSquare";
  import { fly } from "svelte/transition";
  import LastUpdated from "./LastUpdated.svelte";
  import { DeviceDetect as dd } from "../lib/DeviceDetect";
  import { capDescription, satelliteLayer, showForecastPlaybutton, zoomlevel } from "../stores";
  import ScaleLine from "./ScaleLine.svelte";

  let s3Disabled = false;
  let e;
  zoomlevel.subscribe((z) => {
    if (z > 12) {
      satelliteLayer.set("sentinel2");
      if (e) e.checked = true;
      s3Disabled = true;
    } else {
      s3Disabled = false;
    }
  });

  function selectS2() {
    satelliteLayer.set("sentinel2");
    if (e) e.checked = true;
  }

  function selectS3() {
    satelliteLayer.set("sentinel3");
    if (e) e.checked = false;
  }

  function slider(elem) {
    e = elem;
    // elem.tooltipFormatter = (value) => `${value.toString()
    //  .padStart(2, 0)}:00`;
    /// / XXX fix dependency fuckup
    // elem.addEventListener("sl-change", (value) => window.weatherSliderChanged(value.target.value));
    elem.addEventListener("sl-change", (event) => {
      const satellite = event.target.checked ? "sentinel2" : "sentinel3";
      if (event.target.checked) {
        satelliteLayer.set(satellite);
      } else {
        satelliteLayer.set(satellite);
      }
    });
  }

  let description;
  capDescription.subscribe((desc) => {
    description = desc;
  });

  let bottomToolbarVisible = true;
  showForecastPlaybutton.subscribe((val) => {
    bottomToolbarVisible = val;
  });
</script>

<style>
  :global(.bottomToolbar) {
    position: absolute;
    bottom: 0;
    left: 0;
    border-top-left-radius: 11px;
    border-top-right-radius: 11px;
    border-top: 1px solid var(--sl-color-gray-50);
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
    flex-basis: 6%;
    min-width: 84px;
  }

  .right {
    height: 100%;
    text-align: right;
    white-space: nowrap;
    padding: 0;
    flex-grow: 0; /* do not grow   - initial value: 0 */
    flex-shrink: 0; /* do not shrink - initial value: 1 */
    flex-basis: 3%;
  }
  @media only screen and (max-width: 600px) {
    .app-logos {
      display: none;
    }
  }

  .center {
    flex: auto;
    padding: 0.5em;
    font-size: 9pt;
    position: relative;
    flex-grow: 1; /* do not grow   - initial value: 0 */
    flex-shrink: 1; /* do not shrink - initial value: 1 */
    flex-basis: 2%;
    text-align: center;
    margin-right: 1.5%;
  }

  .palette {
    flex: auto;
    padding: 0.5em;
    padding-top: 0.32em;
    position: relative;
    flex-grow: 1; /* do not grow   - initial value: 0 */
    flex-shrink: 1; /* do not shrink - initial value: 1 */
    flex-basis: 70%;
    text-align: center;
    height: 100%;
    margin-left: 1.5%;
    margin-right: 1.5%;
  }

  :global(.githubIcon) {
    font-size: 35px;
    text-shadow: 3px 3px 0 #ffffff, -1px -1px 0 #ffffff, 1px -1px 0 #ffffff,
      -1px 1px 0 #ffffff, 1px 1px 0 #ffffff;
    color: var(--sl-color-info-700) !important;
    padding: 0;
    border-radius: 0;
    margin: 4.5px 0.2em 0 0;
    vertical-align: top;
  }

  .appstoreLogo {
    padding-left: 0px;
    display: inline;
  }

  .appstore-logo{
    margin-top: 6px;
    margin-left: 3px;
    height: 34px;
  }

  .sentinel-label {
    color: var(--sl-color-black);
  }
  .sentinel-label.pad {
    margin-right: 0.5em;
  }
  .sentinel-label > .resolution {
    font-size: 60%;
    opacity: 0.7;
  }

  :global(.legendLabel) {
    font-size: 80%;
    padding-left: 0.15em;
    text-shadow: 0 0 1px #ffffff,
            -1px -1px 1px #ffffff,
            -1px 1px 1px #ffffff,
            1px 1px 1px #ffffff,
            1px -1px 1px #ffffff;
  }
  @media only screen and (max-width: 990px) {
    :global(.legendLabel) {
      display: none;
    }
  }
</style>

<div
  class="bottomToolbar lastUpdatedBottom"
  transition:fly={{ y: 100, duration: 200 }}>
  <div class="parentz">
    <div class="left">
      <!-- empty -->
    </div>
    <div class="palette">
      <ScaleLine style="width: 100%;" valueFormat={ (fmt) => {
        switch (fmt) {
          case "64":
            return " ";
          case "74":
            return "🌤 <span class='legendLabel'>Bedeckt</span>";
          case "84":
            return "🌦 <span class='legendLabel'>Niesel</span>";
          case "94":
            return "🌧 <span class='legendLabel'>Regen</span>";
          case "104":
            return "⛈ <span class='legendLabel'>Starkregen</span>";
          case "114":
            return "🌩 <span class='legendLabel'>Hagel</span>";
          default:
            return "";
        }
      } } palette="58:a3a06728;59:a8a57032;60:acac7946;61:b1b18250;62:b6b88c64;63:bcbd936e;64:c1c39c82;65:c1c39c8c;66:cacdaaa0;67:cccfafaa;68:cccfb3be;69:c8ccb3c8;70:bfc3b3dc;71:bfc3b3e6;72:b8bdb3fa;73:b5bab3ff;74:acb3b3ff;75:aaafb3ff;76:a3aab3ff;77:a0a8b3ff;78:9aa1b3ff;79:97a0b3ff;80:909ab3ff;81:939ab5ff;82:8791b1ff;83:838eb1ff;84:7c89afff;85:7785aeff;86:7080aaff;87:6b7caaff;88:5e72a7ff;89:5e72a7ff;90:566da3ff;91:5269a3ff;92:4b64a1ff;93:4660a0ff;94:4260a1ff;95:4467a5ff;96:4975aeff;97:4d7cb1ff;98:508abaff;99:5491bfff;100:599ec6ff;101:5ba5caff;102:60b3d4ff;103:62bad8ff;104:67c8dfff;105:69cfe4ff;106:67d6d6ff;107:60d6c4ff;108:52d6a1ff;109:4bd690ff;110:3bd66dff;111:34d65bff;112:11d116ff;113:0fcd16ff;114:0fc316ff;115:0fbf15ff;116:0fb613ff;117:0eb313ff;118:0eaa13ff;119:0ca511ff;120:0c9e11ff;121:0c9911ff;122:0c900fff;123:0a8c0fff;124:0a830eff;125:0a800eff;126:0a770cff;127:08720cff;128:086b0aff;129:08660aff;130:085d08ff;131:1c6708ff;132:467c08ff;133:5b8707ff;134:839c05ff;135:97a805ff;136:c1bc05ff;137:d6c603ff;138:ffe200ff;139:ffd800ff;140:ffc800ff;141:ffc300ff;142:ffb500ff;143:ffb000ff;144:ffa700ff;145:ff9e00ff;146:ff9300ff;147:ff8900ff;148:ff7f00ff;149:ff0000ff;150:f00000ff;151:e90000ff;152:db0000ff;153:d40000ff;154:c60000ff;155:bf0000ff;156:b10000ff;157:aa0000ff;158:9a0000ff;159:930000ff;160:850000ff;161:7e0000ff;162:700000ff;163:ffffffff;164:ffe9ffff;165:ffdfffff;166:ffc8ffff;167:ffbdffff;168:ffa8ffff;169:ff9cffff;170:ff75ffff;171:fb6bfdff;172:f656f6ff;173:f24bf4ff;174:ed36efff;175:e92aebff;176:e416e6ff;177:e10ae2ff;178:ac00fbff;179:a300f6ff;180:9300efff;181:8700e9ff;182:7900e2ff;183:7200ddff;184:6200d6ff;185:6200d6ff" />
    </div>
    <div class="center">
      <!--sl-tag
        type="info"
        class="tag"
        size="medium"
        pill>
        ICON 12Z Run 10. Feb
      </sl-tag>
        <sl-tag
                type="info"
                class="tag"
                size="medium"
                pill>
      <sl-range min="0" max="24" value="{roundToHour(new Date())}" step="1" class="range-with-custom-formatter" use:slider></sl-range>
      </sl-tag-->
      {#if bottomToolbarVisible}
      <LastUpdated />
      {:else}
        <sl-tag size="medium" type="info">
          <span class="sentinel-label pad" on:click={selectS3}><span class="resolution">300m/2x day</span> Sentinel-3</span> <sl-switch class="switch" checked="true" use:slider disabled={s3Disabled}></sl-switch> <span class="sentinel-label" on:click={selectS2}>Sentinel-2 <span class="resolution">10m/5 days</span></span>
        </sl-tag>
      {/if}

    </div>
    {#if !dd.isApp()}
      <div class="right">
        <div class="app-logos">
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
            ><Icon icon={faGithubSquare} class="githubIcon" /></a>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
