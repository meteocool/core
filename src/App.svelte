<script>
	import Map from './Map.svelte';
	import Logo from './Logo.svelte';
	import ColorSwitcher from "./ColorSwitcher.svelte";
</script>

<style>
	:global(body) {
		margin: 0;
        padding: 0;
	}
</style>

<Logo />
<ColorSwitcher />
<Map />
