<script>
    import Icon from 'fa-svelte'
    import {faSatelliteDish} from '@fortawesome/free-solid-svg-icons/faSatelliteDish'
    import MiniMap from "./MiniMap.svelte";
    import { createEventDispatcher } from 'svelte';

    let icon = faSatelliteDish;
    export let layerManager;

    function open(elem) {
        elem.target.classList.remove("pulsate");
        let ls = document.getElementById("ls");
        ls.style.display = "block";
        //layerManager.forEachMap(map => map.updateMap());

    }

    function close() {
        document.getElementById("ls").style.display = "none";
    }

    const dispatch = createEventDispatcher();


    function select(evt) {
        let node = evt.target.parentNode;
        while (node) {
            if (node.classList.contains("reflectivity")) {
                dispatch('changeLayer', "reflectivity");
                close();
                return;
            }
            if (node.classList.contains("satellite")) {
                dispatch('changeLayer', "satellite");
                close();
                return;
            }
            node = node.parentNode;
        }
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
    .x { grid-area: x; }

    .cell {
        height: 100%;
        cursor: pointer;
        color: white;
    }

    .label {
        background: #212529;
        border-radius: 10px;
        position: relative;
        z-index: 100;
        display: inline-block;
        top: 50%;
        padding: 4px 12px;
        opacity: 1;
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
            <div class="reflectivity cell" on:click={select}>
                <MiniMap layerManager={layerManager} layer={"radar"} />
                <div class="label">Radar Reflectivity 1km/5min</div>
            </div>
        </div>
    </div>
</div>
