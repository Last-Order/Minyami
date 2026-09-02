import logger from "@/utils/log";
import { DownloadEvent, DownloadEventListener, DownloadEventMap } from "../controller";

type StoredListener = (...args: any[]) => unknown;

interface Subscription {
    readonly listener: StoredListener;
    readonly once: boolean;
}

/** Public observers cannot participate in, or roll back, internal task commits. */
export class DownloadEventHub {
    private readonly subscriptions = new Map<DownloadEvent, Subscription[]>();

    on<TEvent extends DownloadEvent>(event: TEvent, listener: DownloadEventListener<TEvent>): void {
        this.add(event, listener, false);
    }

    once<TEvent extends DownloadEvent>(event: TEvent, listener: DownloadEventListener<TEvent>): void {
        this.add(event, listener, true);
    }

    off<TEvent extends DownloadEvent>(event: TEvent, listener: DownloadEventListener<TEvent>): void {
        const subscriptions = this.subscriptions.get(event);
        if (!subscriptions) {
            return;
        }
        for (let index = subscriptions.length - 1; index >= 0; index--) {
            if (subscriptions[index].listener === listener) {
                subscriptions.splice(index, 1);
                break;
            }
        }
        if (subscriptions.length === 0) {
            this.subscriptions.delete(event);
        }
    }

    emit<TEvent extends DownloadEvent>(event: TEvent, ...args: DownloadEventMap[TEvent]): void {
        const subscriptions = [...(this.subscriptions.get(event) ?? [])];
        for (const subscription of subscriptions) {
            if (subscription.once) {
                // Remove before invocation so a re-entrant emit cannot call a once-listener twice.
                this.removeSubscription(event, subscription);
            }
            try {
                const result = subscription.listener(...args) as unknown;
                if (result && typeof (result as PromiseLike<unknown>).then === "function") {
                    // Observer promises are intentionally detached from the download commit path.
                    Promise.resolve(result).catch((error) => this.reportListenerError(event, error));
                }
            } catch (error) {
                this.reportListenerError(event, error);
            }
        }
    }

    private add<TEvent extends DownloadEvent>(
        event: TEvent,
        listener: DownloadEventListener<TEvent>,
        once: boolean,
    ): void {
        const subscriptions = this.subscriptions.get(event) ?? [];
        subscriptions.push({ listener, once });
        this.subscriptions.set(event, subscriptions);
    }

    private removeSubscription(event: DownloadEvent, target: Subscription): void {
        const subscriptions = this.subscriptions.get(event);
        if (!subscriptions) {
            return;
        }
        const index = subscriptions.indexOf(target);
        if (index >= 0) {
            subscriptions.splice(index, 1);
        }
        if (subscriptions.length === 0) {
            this.subscriptions.delete(event);
        }
    }

    private reportListenerError(event: DownloadEvent, error: unknown): void {
        logger.warning(`Download event listener for ${event} failed and was isolated from the session.`);
        logger.debug(error);
    }
}
