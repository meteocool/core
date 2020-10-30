<script>
	import logo from "../assets/logo.svg";
    import InlineSVG from 'svelte-inline-svg'
	import About from './About.svelte';

	let showAbout = false;
    import '@shoelace-style/shoelace/dist/shoelace/shoelace.css';
    import { defineCustomElements, setAssetPath } from '@shoelace-style/shoelace';

    export let device;
    //let topMargin = "1vh";

    //$: if (device === "ios") {
    //    topMargin = "10vh";
    //}

    setAssetPath(document.currentScript.src);
    defineCustomElements();
</script>

<style>
    .logo-wrapper {
        z-index: 10;
        position: absolute;
        top: env(safe-area-inset-top);
        left: 0;
        margin-left: 0;
        padding: 0;

        border-top-right-radius: 15px;
        border-bottom-right-radius: 15px;
        background-color: white;

        font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,Noto Sans,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji;

        color: #212529;
        text-align: left;
        height: 6vh;
        vertical-align: top;
        border: 1px solid #f8f9fa;
        background-color: white;
        min-height: 32px;
    }
    .name {
        display: inline-block;
        vertical-align:top;
        margin-right: 10px;
        padding-top: 0px;
        padding-right: 6px;
        font-size: max(2.9vh, 15px);
    }
    .claim {
        font-size: max(1.5vh, 8px);
    }
</style>

<div class="logo-wrapper">
    <InlineSVG src={logo} alt="meteocool" class="logo" style="height: 90%; float: left; padding: 0.5vh 1vh 1vh; "/>
    <div class="name">meteocool.com</div>
    <div class="claim"><span on:click="{() => showAbout = true}">Find out more, get the App!</span></div>
    {#if showAbout}
	<About on:close="{() => showAbout = false}">
        <a href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623">iOS</a> & <a href="https://play.google.com/store/apps/details?id=com.meteocool">Android</a>
        Lorem ipsum dolor sit, amet consectetur adipisicing elit. Nemo doloribus tenetur dolorem vero rem minus numquam. Voluptate, tenetur dolore, quidem quae voluptas voluptatibus itaque minus eligendi adipisci quibusdam dignissimos quo!
	</About>
    {/if}
</div>
