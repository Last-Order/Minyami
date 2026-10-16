import { createArchiveDownloader } from "@/core/archive";
import { createLiveDownloader } from "@/core/live";
import ProxyAgentHelper from "@/utils/agent";
import logger from "@/utils/log";
import { CliOptions } from "./arguments";
import { readConfigFile } from "./config_file";
import { installCliDownloadControls } from "./download_controls";
import { createCliDownloadConfiguration, mergeCliOptions } from "./download_options";

/** Runs one download command while keeping process policy outside the reusable downloader. */
export async function runDownloadCommand(sourcePath: string, commandOptions: CliOptions): Promise<void> {
    try {
        // Apply process policy only after defaults and explicit CLI overrides have been validated together.
        const fileOptions = readConfigFile();
        const options = mergeCliOptions(commandOptions, fileOptions);
        if (options.verbose) {
            logger.enableDebugMode();
        }
        if (Object.keys(fileOptions).length > 0) {
            logger.debug("Loaded configuration file defaults.");
        }
        const config = createCliDownloadConfiguration(options);
        await configureDefaultProxy(options.noProxy);

        const downloader = config.live
            ? createLiveDownloader(sourcePath, config.downloader)
            : createArchiveDownloader(sourcePath, { ...config.downloader, slice: config.slice });
        const dispose = installCliDownloadControls(downloader, !!options.verbose, config.live);
        try {
            await downloader.download();
        } catch {
            // The session already reported runtime failures; initialization failures are reported below.
            process.exitCode = 1;
        } finally {
            dispose();
        }
    } catch (error) {
        logger.error("Unable to initialize download.", error instanceof Error ? error : new Error(String(error)));
        process.exitCode = 1;
    }
}

async function configureDefaultProxy(noProxy: boolean | undefined): Promise<void> {
    const disableProxy = noProxy || process.env.NO_PROXY;
    if (disableProxy) {
        ProxyAgentHelper.disableProxy();
        return;
    }

    if (process.platform === "win32") {
        await ProxyAgentHelper.readWindowsSystemProxy();
    }
    ProxyAgentHelper.readProxyConfigurationFromEnv();
}
