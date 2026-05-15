<script lang="ts">
    let { text = "Home" } = $props();
</script>

<span class="material-symbols-rounded">{text}</span>

<style>
    .material-symbols-rounded {
        font-size: var(--text-xl) !important;
        /*--fill: 0;*/
        --weight: 400;
        --grad: 0;
        --opsz: 0;
        transition: font-variation-settings 250ms ease;
        width: fit-content;
        height: fit-content;
        position: relative;
        font-variation-settings:
            "FILL" var(--fill, 0),
            "wght" var(--weight),
            "GRAD" var(--grad),
            "opsz" var(--opsz);
    }
</style>
