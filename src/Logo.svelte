<script>
    import logo from "../assets/logo.svg";
    import About from './About.svelte';

    let showAbout = false;

    function toggleAbout() {
        if (!showAbout) {
            showAbout = true;
        } else {
            showAbout = false;
        }
    }


</script>

<style>
    .logo-wrapper {
        z-index: 10;
        position: absolute;
        top: max(env(safe-area-inset-top), 1vh);
        left: 0;
        margin-left: 0;
        padding: 0;

        border-top-right-radius: 15px;
        border-bottom-right-radius: 15px;
        background-color: white;

        font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji;

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
        vertical-align: top;
        margin-right: 10px;
        padding-top: 0px;
        padding-right: 6px;
        font-size: max(2.9vh, 15px);
    }

    .claim {
        font-size: max(1.5vh, 8px);
    }
    .link {
        text-decoration: underline;
        cursor: pointer;
    }
</style>

<div class="logo-wrapper">
    <img src={logo} alt="meteocool" class="logo" style="height: 90%; float: left; padding: 0.5vh 1vh 1vh; " />
    <div class="name">meteocool.com</div>
    <!-- <div class="claim">Get the App! <a href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623">iOS</a> & <a href="
https://play.google.com/store/apps/details?id=com.meteocool">Android</a>
    </div> -->
    <div class="claim">
        <span on:click="{() => toggleAbout()}" class="link">About</span> | Join the community
    </div>
    {#if showAbout}
    <About on:close="{() => toggleAbout()}"></About>
    {/if}
</div>
