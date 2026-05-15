<script lang="ts">
    let { children } = $props();
</script>

<div class="expand flex navbar-content">
    {@render children()}
</div>

<style>
    .navbar-content {
        flex: 1;
        justify-content: flex-start;
        flex-direction: column;
    }
    @scope (.mobile) {
        @media (orientation: portrait) {
            .navbar-content {
                flex-direction: row;
            }
        }
    }
</style>
