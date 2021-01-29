<script>
   import { createEventDispatcher } from 'svelte';

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

<sl-dialog label="About meteocool" class="dialog-overview" style="--width: 50vw;" use:init>
    <div style="float: right; width: 180px; margin: 1em;">
        <a href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623"><img src="assets/ios-app-store.png"
                                                                                      alt="ios app store link" class="appstore-logo" style="width: 100%;"></a>
        <a href="https://play.google.com/store/apps/details?id=com.meteocool"><img class="appstore-logo"
                                                                                   alt="google play app store" src="assets/google-play-store.png" style="width: 100%;"></a>
    </div>
    <p>meteocool is a free GIS visualisation &amp; aggregation platform with focus on severe weather. Optimized for
        mobile devices, you can use it to both chase or avoid upcoming weather - that’s up to you.</p>
    <p>meteocool currently uses radar data provided by DWD and realtime lightning information from the awesome
        blitzortung.org project.</p>
    <h2>Features</h2>
    <ul>
        <li><strong>Automatic Map Updates:</strong> the biggest inconvenience with most weather radar visualisations
            is out-of-date data. meteocool notifies its clients as soon as new radar data becomes available and the
            client tries to be transparent about the dataset age. Say goodbye to hammering F5!</li>
        <li><strong>Live Lightning Strikes:</strong> new lightning strikes are displayed instantly, giving you an
            even better feeling for the cloud formation’s intensity, trajectory and speed.</li>
        <li><strong>Push Notifications:</strong> get notified about incoming rain up to 45 minutes in advance. Works
            on iOS and Android.</li>
        <li><strong>iOS &amp; Android Apps:</strong> native iOS and Android apps provide battery-efficient
            background location services to allow for accurate rain notifications without user interaction.</li>
    </ul>
    <h2>Credits & Help</h2>
    <p>
    <img src="assets/volunteers.png" class="volunteers" alt="not actually the volunteers">
    <p>meteocool is maintained by <a href="https://unimplemented.org/">Valentin Dornauer</a>. Jonas is still looking for his place, for now he's paying.<br>This project would not have been possible without the help from a few great people:</p>
    <ul>
        <li>iOS App: Thanks to <a href="https://mauracher.eu/">Florian Mauracher</a>, <a href="https://github.com/nina2244">Nina Loser</a></li>
        <li>Android App: maintained by <a href="https://github.com/Wheedman">Jeremias Wiedmann</a></li>
        <li>Honorable mentions: <a href="https://github.com/NessArt">NessArt</a>
        <li>Icons and adapted artwork made by <a href="http://www.freepik.com" title="Freepik"
                                                 rel="noreferrer">Freepik</a> (Logo, iOS Onboarding) from <a
                href="https://www.flaticon.com/" title="Flaticon">www.flaticon.com</a> (licensed by <a
                href="http://creativecommons.org/licenses/by/3.0/" title="Creative Commons BY 3.0"
                rel="noreferrer">CC 3.0 BY</a>)</li>
    </ul>
    <p>Want to help as well? Check out <a href="https://github.com/meteocool" rel="noreferrer">meteocool on GitHub</a> especially our <a href="https://github.com/meteocool/web">web frontend</a>, <a
            href="https://github.com/meteocool/ios">iOS</a> and <a
            href="https://github.com/meteocool/android">Android</a> repositories.
    </p>
    <h2>other things</h2>
    <ul>
        <li><a href="mailto:support@meteocool.com">contact us for questions or if you want to send money our way</a>
        </li>
        <li><a href="/privacy.html">privacy policy</a></li>
    </ul>
    <sl-button slot="footer" type="primary" on:click={close}>Close</sl-button>
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
