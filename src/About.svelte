<script>
   import { createEventDispatcher } from 'svelte';
   import {_} from "svelte-i18n";

   const dispatch = createEventDispatcher();

   function init(elem) {
     elem.addEventListener('sl-overlay-dismiss', event => {
       dispatch('close');
       return event.preventDefault();
     });
     elem.show();
   }

   function close() {
     dispatch('close');
   }
</script>

<sl-dialog label="{$_('title')}" class="dialog-overview" style="--width: 50vw;" use:init>
    <div style="float: right; width: 180px; margin: 1em;">
        <a href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623"><img src="assets/ios-app-store.png"
                                                                                      alt="ios app store link" class="appstore-logo" style="width: 100%;"></a>
        <a href="https://play.google.com/store/apps/details?id=com.meteocool"><img class="appstore-logo"
                                                                                   alt="google play app store" src="assets/google-play-store.png" style="width: 100%;"></a>
    </div>
    <p>{$_('text1')}</p>
    <p>{$_('text2')}</p>
    <h2>{$_('features.header')}</h2>
    <ul>
        <li><strong>{$_('features.list_title1')}</strong>{$_('features.list1')}</li>
        <li><strong>{$_('features.list_title2')}</strong>{$_('features.list2')}</li>
        <li><strong>{$_('features.list_title3')}</strong>{$_('features.list3')}</li>
        <li><strong>{$_('features.list_title4')}</strong>{$_('features.list4')}</li>
    </ul>
    <h2>{$_('credits_help.header')}</h2>
    <p>
    <img src="assets/volunteers.png" class="volunteers" alt="not actually the volunteers">
    <p>{$_('credits_help.text1')}<a href="https://unimplemented.org/">Valentin Dornauer</a>. {$_('credits_help.text2')}<br>{$_('credits_help.text3')}</p>
    <ul>
        <li>{$_('credits_help.list1')}<a href="https://mauracher.eu/">Florian Mauracher</a>, <a href="https://github.com/nina2244">Nina Loser</a></li>
        <li>{$_('credits_help.list2')}<a href="https://github.com/Wheedman">Jeremias Wiedmann</a></li>
        <li>{$_('credits_help.list3')}<a href="https://github.com/NessArt">NessArt</a>
        <li>{$_('credits_help.list4.text1')}<a href="http://www.freepik.com" title="Freepik"
                                                 rel="noreferrer">Freepik</a>{$_('credits_help.list4.text2')}<a
                href="https://www.flaticon.com/" title="Flaticon">www.flaticon.com</a>{$_('credits_help.list4.text3')}<a
                href="http://creativecommons.org/licenses/by/3.0/" title="Creative Commons BY 3.0"
                rel="noreferrer">CC 3.0 BY</a>)</li>
    </ul>
    <p>{$_('credits_help.text4')}<a href="https://github.com/meteocool" rel="noreferrer">{$_('credits_help.text5')}</a>{$_('credits_help.text6')}<a href="https://github.com/meteocool/web">{$_('credits_help.text7')}</a>, <a
            href="https://github.com/meteocool/ios">iOS</a>{$_('credits_help.text8')}<a
            href="https://github.com/meteocool/android">Android</a>{$_('credits_help.text9')}.
    </p>
    <h2>{$_('other_things.header')}</h2>
    <ul>
        <li><a href="mailto:support@meteocool.com">{$_('other_things.list1')}</a></li>
        <li><a href="/privacy.html">{$_('other_things.list2')}</a></li>
    </ul>
    <sl-button slot="footer" type="primary" on:click={close}>{$_('close')}</sl-button>
</sl-dialog>

<style>
    .appstore-logo {
        width: 200px;
        height: auto;
    }

    :global(.dialog-overview::part(base)) {
        bottom: 7%;
    }

    .volunteers {
        float: right;
        width: 35%;
        padding: 1em;
    }
</style>
