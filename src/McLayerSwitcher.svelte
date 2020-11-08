<script>
    import Icon from 'fa-svelte'
    import {faSatelliteDish} from '@fortawesome/free-solid-svg-icons/faSatelliteDish'
    import MiniMap, {layer} from "./MiniMap.svelte";
    import { createEventDispatcher } from 'svelte';
    import {device} from "./App.svelte";

    let icon = faSatelliteDish;
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

    .pulsate {
        box-shadow: 0 0 0 0 rgba(0, 0, 0, 1);
        transform: scale(1);
        animation: pulse 2s infinite;
    }

    @keyframes pulse {
        0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(0, 0, 0, 0.7);
        }

        70% {
            transform: scale(1);
            box-shadow: 0 0 0 10px rgba(0, 0, 0, 0);
        }

        100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
        }
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
        grid-template-areas: "reflectivity satellite" "weather x";
        height: 100%;
    }

    .reflectivity { grid-area: reflectivity; }
    .satellite { grid-area: satellite; }
    .weather { grid-area: weather; }

    .cell {
        height: 100%;
        cursor: pointer;
        color: white;
    }


</style>

{#if document.currentScript.getAttribute('device') !== 'ios'}
<div class="lsToggle pulsate" on:click={open}>
    <Icon icon={icon} class="lsIcon"></Icon>
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
        </div>
    </div>
</div>
