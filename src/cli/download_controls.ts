import { DownloadController } from "@/core/download/downloader";
import logger from "@/utils/log";

/** Installs process-facing progress and signal controls around one CLI download. */
export function installCliDownloadControls(
    downloader: DownloadController,
    verbose: boolean,
    handleSignals: boolean,
): () => void {
    const verboseTimer = verbose
        ? setInterval(() => {
              const snapshot = downloader.getSnapshot();
              logger.debug(
                  `Waiting tasks: ${snapshot.pendingTaskCount}, completed chunks: ${snapshot.completedChunkCount}, successful chunks: ${snapshot.successfulChunkCount}, dropped chunks: ${snapshot.droppedChunkCount}, total discovered chunks: ${snapshot.totalChunkCount}`,
              );
          }, 3000)
        : undefined;

    let sigintCount = 0;
    const onSigint = () => {
        sigintCount++;
        if (sigintCount === 1) {
            logger.info("Ctrl+C pressed, waiting for known tasks to finish.");
            downloader.stop();
            return;
        }
        downloader.abort();
    };
    if (handleSignals) {
        process.on("SIGINT", onSigint);
    }

    return () => {
        if (verboseTimer) {
            clearInterval(verboseTimer);
        }
        process.off("SIGINT", onSigint);
    };
}
