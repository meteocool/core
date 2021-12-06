<script>
export let gridConfig;
export let latest;
</script>


<style>
    .dev {
        line-height: 1;
    }
</style>

<sl-tag type="danger" size="medium" pill>
    <div class="dev">
    Now: { new Date(gridConfig.now * 1000.0) }<br/>
    WX: { new Date(latest * 1000.0) }
    </div>
</sl-tag>
