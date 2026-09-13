<!--
  Replaces fa-svelte, which was last published in 2020 and does not run under
  Svelte 5. It rendered exactly this: the path data a Font Awesome icon object
  already carries, in an inline SVG.
-->
<script>
  export let icon;

  let className = "";
  export { className as class };

  $: [width, height, , , path] = icon.icon;
</script>

<svg
  aria-hidden="true"
  class="fa-svelte {className}"
  role="img"
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 {width} {height}"
>
  <path fill="currentColor" d={Array.isArray(path) ? path.join(" ") : path} />
</svg>

<style>
  .fa-svelte {
    width: 1em;
    height: 1em;
    overflow: visible;
    display: inline-block;
  }
</style>
