import { defineConfig } from "tsdown";

export default defineConfig({
    entry: {
        exports: "src/exports.ts",
        index: "src/index.ts",
    },
    format: "esm",
    platform: "node",
    target: "node24",
    fixedExtension: true,
    clean: true,
    sourcemap: true,
    dts: {
        entry: "src/exports.ts",
        resolver: "tsc",
    },
    // Runtime dependencies stay independently upgradeable and are installed alongside the package.
    deps: {
        neverBundle: true,
    },
});
