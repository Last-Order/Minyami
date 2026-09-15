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
    if (commandOptions.verbose) {
        logger.enableDebugMode();
    }

    await configureDefaultProxy(commandOptions.noProxy);

    const fileOptions = readConfigFile();
    if (Object.keys(fileOptions).length > 0) {
        logger.debug(`Read config file: ${JSON.stringify(fileOptions)}`);
    }
    const options = mergeCliOptions(commandOptions, fileOptions);
    const config = createCliDownloadConfiguration(options);
    const downloader = config.live
        ? createLiveDownloader(sourcePath, config.downloader)
        : createArchiveDownloader(sourcePath, { ...config.downloader, slice: config.slice });
    const dispose = installCliDownloadControls(downloader, !!options.verbose, config.live);
    try {
        await downloader.download();
    } catch {
        process.exitCode = 1;
    } finally {
        dispose();
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
