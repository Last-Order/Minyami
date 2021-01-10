import { EventEmitter } from "events";

type TaskRunner<T, V> = (item: T) => Promise<V>;

/**
 * Use case:
 *
 * const pool = new TaskPool(3, (data) => new Promise<void>((resolve) => {
 *   setTimeout(() => resolve(), data * 1000);
 * }), [10, 2, 5, 1]);
 *
 * pool.on("success", (data) => console.error(data));
 *
 * pool.start();
 * pool.add(1);
 * pool.add(1);
 * pool.add(10);
 * pool.add(5);
 * pool.add(2);
 */
export class TaskPool<T, V> extends EventEmitter {
    private items: T[] = [];
    private pool: Promise<V>[] = [];
    private runner: TaskRunner<T, V>;

    private end: boolean = false;
    private forceEnd: boolean = false;

    private threads: number;
    private events: EventEmitter = new EventEmitter();

    constructor(threads: number, fn: TaskRunner<T, V>, items: T[] = []) {
        super();
        this.threads = threads;
        this.runner = fn;
        this.items.push(...items);
    }

    async start(): Promise<void> {
        // return directly when end && (idle || forced to end)
        if (this.end && (this.forceEnd || this.idle())) {
            return;
        }

        // Run as many tasks as possible
        while (this.pool.length < this.threads && this.items.length > 0) {
            this.runTask(this.items.shift() as T);
        }

        // Wait for a task in pool to finish
        if (this.pool.length > 0) {
            await Promise.race(this.pool);
        }

        if (!this.idle() || (await this.waitForInput())) {
            return await this.start();
        }
    }

    private runTask(item: T) {
        const task = this.runner(item)
            .then((resp) => {
                this.emit("success", item, resp);
                this.pool.splice(this.pool.indexOf(task), 1);
                return resp;
            })
            .catch((err) => {
                this.emit("error", item, err);
                this.pool.splice(this.pool.indexOf(task), 1);
                return err;
            });
        this.pool.push(task);
    }

    private async waitForInput() {
        return await new Promise<boolean>((resolve) => {
            if (this.end) {
                this.emit("end");
                resolve(false);
            }

            this.events.once("done", () => {
                this.emit("end");
                resolve(false);
            });

            this.events.once("item", () => {
                // Remove 'done' listener
                this.events.removeAllListeners();
                resolve(true);
            });
        });
    }

    add(item: T, urgent = false) {
        if (this.end) return;

        const wasIdle = this.idle();
        if (urgent) {
            this.items.unshift(item);
        } else {
            this.items.push(item);
        }
        if (wasIdle) {
            this.events.emit("item");
        }
    }

    stop(force = false) {
        if (force) {
            this.forceEnd = true;
        }
        this.end = true;
        this.events.emit("done");
    }

    idle() {
        return this.items.length === 0 && this.pool.length === 0;
    }

    ended() {
        return this.end && this.idle();
    }
}
