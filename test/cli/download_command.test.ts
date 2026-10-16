import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { readConfigFile } from "@/cli/config_file";
import { runDownloadCommand } from "@/cli/download_command";
import { installCliDownloadControls } from "@/cli/download_controls";
import { createArchiveDownloader } from "@/core/archive";
import { DownloadController } from "@/core/download/downloader";
import { createLiveDownloader } from "@/core/live";
import ProxyAgentHelper from "@/utils/agent";
import logger from "@/utils/log";

jest.mock("@/core/archive");
jest.mock("@/core/live");
jest.mock("@/cli/config_file");
jest.mock("@/cli/download_controls");

const controller: DownloadController = {
    download: jest.fn<DownloadController["download"]>(),
    stop: jest.fn<DownloadController["stop"]>(),
    abort: jest.fn<DownloadController["abort"]>(),
    getSnapshot: jest.fn<DownloadController["getSnapshot"]>(),
    on() {
        return controller;
    },
    once() {
        return controller;
    },
    off() {
        return controller;
    },
};
const dispose = jest.fn<() => void>();
const originalNoProxy = process.env.NO_PROXY;
const originalExitCode = process.exitCode;

beforeEach(() => {
    delete process.env.NO_PROXY;
    process.exitCode = undefined;
    jest.mocked(controller.download).mockResolvedValue(undefined);
    jest.mocked(readConfigFile).mockReturnValue({});
    jest.mocked(createArchiveDownloader).mockReturnValue(controller);
    jest.mocked(createLiveDownloader).mockReturnValue(controller);
    jest.mocked(installCliDownloadControls).mockReturnValue(dispose);
    jest.spyOn(ProxyAgentHelper, "disableProxy").mockImplementation(() => undefined);
    jest.spyOn(ProxyAgentHelper, "readWindowsSystemProxy").mockResolvedValue(undefined);
    jest.spyOn(ProxyAgentHelper, "readProxyConfigurationFromEnv").mockImplementation(() => undefined);
    jest.spyOn(logger, "enableDebugMode").mockImplementation(() => undefined);
    jest.spyOn(logger, "debug").mockImplementation(() => undefined);
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    if (originalNoProxy === undefined) {
        delete process.env.NO_PROXY;
    } else {
        process.env.NO_PROXY = originalNoProxy;
    }
    process.exitCode = originalExitCode;
});

describe("download command configuration", () => {
    test("applies config-file proxy and debug flags before starting a download", async () => {
        jest.mocked(readConfigFile).mockReturnValue({ noProxy: true, verbose: true, threads: 8 });

        await runDownloadCommand("custom://archive", {});

        expect(ProxyAgentHelper.disableProxy).toHaveBeenCalledTimes(1);
        expect(ProxyAgentHelper.readWindowsSystemProxy).not.toHaveBeenCalled();
        expect(ProxyAgentHelper.readProxyConfigurationFromEnv).not.toHaveBeenCalled();
        expect(logger.enableDebugMode).toHaveBeenCalledTimes(1);
        expect(createArchiveDownloader).toHaveBeenCalledWith(
            "custom://archive",
            expect.objectContaining({ threads: 8 }),
        );
        expect(installCliDownloadControls).toHaveBeenCalledWith(controller, true, false);
        expect(controller.download).toHaveBeenCalledTimes(1);
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    test("explicit false flags override configuration defaults", async () => {
        jest.mocked(readConfigFile).mockReturnValue({ noProxy: true, verbose: true });

        await runDownloadCommand("custom://archive", { noProxy: false, verbose: false });

        expect(ProxyAgentHelper.disableProxy).not.toHaveBeenCalled();
        expect(ProxyAgentHelper.readProxyConfigurationFromEnv).toHaveBeenCalledTimes(1);
        expect(logger.enableDebugMode).not.toHaveBeenCalled();
        expect(installCliDownloadControls).toHaveBeenCalledWith(controller, false, false);
    });

    test("uses merged defaults to select the live downloader", async () => {
        jest.mocked(readConfigFile).mockReturnValue({ live: true, noProxy: true });

        await runDownloadCommand("custom://live", {});

        expect(createLiveDownloader).toHaveBeenCalledTimes(1);
        expect(createArchiveDownloader).not.toHaveBeenCalled();
        expect(installCliDownloadControls).toHaveBeenCalledWith(controller, false, true);
    });

    test("continues with CLI settings when no usable configuration defaults are available", async () => {
        jest.mocked(readConfigFile).mockReturnValue({});

        await runDownloadCommand("custom://archive", { threads: 3, noProxy: true });

        expect(process.exitCode).toBeUndefined();
        expect(logger.error).not.toHaveBeenCalled();
        expect(createArchiveDownloader).toHaveBeenCalledWith(
            "custom://archive",
            expect.objectContaining({ threads: 3 }),
        );
        expect(controller.download).toHaveBeenCalledTimes(1);
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    test("rejects invalid config flags before configuring a proxy", async () => {
        jest.mocked(readConfigFile).mockReturnValue({ noProxy: "false" });

        await runDownloadCommand("custom://archive", {});

        expect(process.exitCode).toBe(1);
        expect(logger.error).toHaveBeenCalledWith(
            "Unable to initialize download.",
            expect.objectContaining({ message: "Option noProxy must be a boolean." }),
        );
        expect(ProxyAgentHelper.disableProxy).not.toHaveBeenCalled();
        expect(ProxyAgentHelper.readProxyConfigurationFromEnv).not.toHaveBeenCalled();
        expect(controller.download).not.toHaveBeenCalled();
    });

    test("still disposes controls after a runtime failure without reporting it twice", async () => {
        jest.mocked(controller.download).mockRejectedValue(new Error("session already reported this"));

        await runDownloadCommand("custom://archive", {});

        expect(process.exitCode).toBe(1);
        expect(logger.error).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledTimes(1);
    });
});
