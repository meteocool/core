<script>
  import Icon from 'fa-svelte'
  import { capDescription } from './stores';
  import {faGithubSquare} from '@fortawesome/free-brands-svg-icons/faGithubSquare';
  import { fly } from 'svelte/transition';
  import { cssGetclass } from './lib/css';

  export let nowcast;
  export let cap;
  let target;
  let activeForecastTimeout;
  let iconHTML;
  let baseTime;
  let description;

  capDescription.subscribe(value => {
    description = value;
  });

  function show() {
    cssGetclass(".sl-toast-stack").style.bottom="calc(env(safe-area-inset-bottom) + 42px)";
  }
</script>

<style>
    .bottomToolbar {
        position: absolute;
        bottom: 0;
        left: 0;
        background-color: white;
        border-top-left-radius: 11px;
        border-top-right-radius: 11px;
        border-top: 1px solid lightgray;
        width: 100%;
    }

    .lastUpdatedBottom {
        height: 42px;
        padding-bottom: env(safe-area-inset-bottom);
        bottom: 0;
        z-index: 99;
        padding-top: 0.2em;
        padding-bottom: 0.2em;
    }

    .parentz {
        display: flex;
    }

    .left{
        height: 28px;
        text-align: center;
        float: left;
        cursor: pointer;
        text-decoration: underline;
        flex-grow: 1;     /* do not grow   - initial value: 0 */
        flex-shrink: 0;   /* do not shrink - initial value: 1 */
        flex-basis: 7%;
    }

    .right{
        height: 100%;
        text-align: right;
        white-space: nowrap;
        flex-grow: 1;     /* do not grow   - initial value: 0 */
        flex-shrink: 0;   /* do not shrink - initial value: 1 */
        flex-basis: 13%;
    }
    @media only screen and (max-width: 600px) {
        .right {
            display: none;
        }
    }
    @media only screen and (max-width: 1350px) {
        .center {
            display: none;
        }
    }

    .center {
        flex: auto;
        font-family: Quattrocento;
        padding: 0.5em;
        font-size: 9pt;
        text-indent: 2em;
        font-style: italic;
    }

    .controlButton {
        width: 1em;
        height: 1em;
        padding: 0.5em;
        border: 1px solid grey;
        border-radius: 5px;
        flex:1 1 auto;
        text-align:center;
        margin: 0.25em;
    }

    .controlButton:hover {
        background-color: #333333;
        border: 1px solid #333333;
        color: white;
        cursor: pointer;
    }

    div :global(.githubIcon) {
        font-size: 32px;
        text-shadow:
                3px 3px 0 #ffffff,
                -1px -1px 0 #ffffff,
                1px -1px 0 #ffffff,
                -1px 1px 0 #ffffff,
                1px 1px 0 #ffffff;
        color: black !important;
        padding: 0;
        margin: 6px 0.2em 0 0;
    }

    .appstoreLogo {
        margin-left: 0.1em;
        padding-left: 0px;
        display: inline;
    }
</style>

<link rel="stylesheet" type="text/css" href="//fonts.googleapis.com/css?family=Quattrocento" />
<div class="bottomToolbar lastUpdatedBottom" transition:fly="{{ y: 100, duration: 200 }}">
    <div class="parentz">
        <div class="left">
            <!-- empty -->
        </div>
        <div class="center">
            {description}
        </div>
        <div class="right">
            <div class="appstoreLogo"><a target="_blank" href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623"><img src="assets/ios-app-store.png" alt="ios app store link" class="appstore-logo" style="height: 30px;"></a></div>
            <div class="appstoreLogo"><a target="_blank" href="https://play.google.com/store/apps/details?id=com.meteocool"><img class="appstore-logo" alt="google play app store" src="assets/google-play-store.png" style="height: 30px;"></a></div>
            <div class="appstoreLogo"><a target="_blank" href="https://github.com/meteocool/core#meteocool"><Icon icon={faGithubSquare} class="githubIcon"></Icon></a></div>
        </div>
    </div>
</div>
