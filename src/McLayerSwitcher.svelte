<script>
    import Icon from 'fa-svelte'
    import { faLayerGroup } from '@fortawesome/free-solid-svg-icons/faLayerGroup'
    import MiniMap from "./MiniMap.svelte";
    import { createEventDispatcher } from 'svelte';

    export let layerManager;
    let childCanvases = {};

    window.openLayerswitcher = () => {
        let ls = document.getElementById("ls");
        ls.style.display = "block";
        layerManager.forEachMap(map => {
            const cap = map.get("capability");
            const target = childCanvases[map.get("capability")];
            console.log(`set ${cap} -> ${target}`)
            map.setTarget(target);
            map.updateSize();
        });
    }

    function open(elem) {
        elem.target.classList.remove("pulsate");
        window.openLayerswitcher();
    }

    function close() {
        document.getElementById("ls").style.display = "none";
        if ("webkit" in window) {
            window.webkit.messageHandlers["scriptHandler"].postMessage("layerSwitcherClosed");
        }
    }

    function childMounted(data) {
        childCanvases[data.detail.layer] = data.detail.id;
    }

    const dispatch = createEventDispatcher();

    function changeLayer(event) {
        close()
        dispatch('changeLayer', event.detail);
    }

</script>

<style>
    .lsToggle {
        width: 74px;
        height: 74px;
        background-color: #f8f9fa;
        border: 3px solid #333333;
        border-radius: 40px;
        position: absolute;
        top: 1vh;
        right: 1vh;
        text-align: center;
        vertical-align: center;
    }

    .lsToggle:hover {
        background-color: #666666;
        color: white;
        cursor: pointer;
    }

    div :global(.lsIcon) {
        font-size: 40px;
        position: absolute;
        top: 50%;
        left: 50%;
        -ms-transform: translate(-50%, -50%);
        transform: translate(-50%, -50%);
        stroke: white;
    }

    .ls {
        width: 100%;
        height: 100%;
        position: absolute;
        top: 0px;
        left: 0px;
        display: none;
        background-color: black;
        overflow-y: hidden;
        z-index: 10000000;
    }

    .gridContainer {
        height: 99%;
        width: 99.5%;
        text-align: center;
        display: block;
        margin: 0.1em auto;
    }

    .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1fr 1fr;
        gap: 0.15em 0.1em;
        grid-template-areas: "reflectivity satellite" "weather help";
        height: 100%;
    }

    .reflectivity { grid-area: reflectivity; }
    .satellite { grid-area: satellite; }
    .weather { grid-area: weather; }
    .help { grid-area: help; }

    .cell {
        height: 100%;
        cursor: pointer;
        color: white;
    }

    .help {
        font-family: Quattrocento;
        color: white;
        text-align: center;
        text-indent: 2em;
        line-height: 1.5;
        transform: translateY(30%);
        cursor: default;
    }


</style>

{#if window.device !== 'ios' && window.device !== 'android'}
<div class="lsToggle" on:click={open}>
    <Icon icon={faLayerGroup} class="lsIcon"></Icon>
</div>
{/if}

<div class="ls" id="ls">
    <div class="gridContainer">
        <div class="grid">
            <div class="reflectivity cell">
                <MiniMap layerManager={layerManager} layer={"radar"} label={"⚡️ Rain & Thunderstorms"}
                         on:mount={childMounted}
                         on:changeLayer={changeLayer}
                />
            </div>
            <div class="satellite cell">
                <MiniMap layerManager={layerManager} layer={"satellite"} label={"🛰️ Real-Time Satellite"}
                         on:mount={childMounted}
                         on:changeLayer={changeLayer}
                />
            </div>
            <div class="weather cell">
                <MiniMap layerManager={layerManager} layer={"weather"} label={"🌤 Weather "}
                         on:mount={childMounted}
                         on:changeLayer={changeLayer}
                />
            </div>
            <div class="help cell">
                <div class="help">💡<br />Today's weather is hardly worth mentioning?<br />Explore the near-realtime satellite map!<p><i>More maps coming soon.</i></p></div>
            </div>
        </div>
    </div>
</div>
