import * as fs from "fs";
import { sleep } from "../utils/system";
import log from "../utils/log";

export enum TaskStatus {
    PENDING,
    DONE,
    DROPPED,
}

interface FileConcentratorParams {
    taskStatusRecord: TaskStatus[];
    outputPath: string;
    deleteAfterWritten?: boolean;
    ignoreBreakpoints?: boolean;
}

interface ConcentrationTask {
    filePath: string;
    index: number;
}

function getFileExt(filePath: string): string {
    let ext = "";
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
        const urlPath = new URL(filePath).pathname.slice(1).split("/");
        if (urlPath[urlPath.length - 1].includes(".")) {
            ext = urlPath[urlPath.length - 1].split(".").slice(-1)[0];
        }
    } else {
        const filePathArr = filePath.split("/");
        const filename = filePathArr[filePathArr.length - 1];
        ext = filename.includes(".") ? filename.split(".").slice(-1)[0] : "";
    }
    return ext;
}

class FileConcentrator {
    taskStatusRecords: TaskStatus[];

    taskWriteCount: number[] = [0];

    breakpoints: number[] = [];

    tasks: ConcentrationTask[] = [];

    outputFilename: string;

    outputFileExt: string;

    writeStream: fs.WriteStream;

    lastFinishIndex: number = -1;

    writeSequence: number = 0;

    isCheckingWritableFiles = false;

    deleteAfterWritten = false;

    ignoreBreakpoints = false;

    constructor({ taskStatusRecord, outputPath, deleteAfterWritten, ignoreBreakpoints }: FileConcentratorParams) {
        this.taskStatusRecords = taskStatusRecord;

        const ext = getFileExt(outputPath);
        this.outputFilename = outputPath.slice(0, -ext.length - 1);
        this.outputFileExt = ext;
        if (deleteAfterWritten) {
            this.deleteAfterWritten = true;
        }
        if (ignoreBreakpoints) {
            this.ignoreBreakpoints = true;
        }
        this.createNextWriteStream();
    }

    private async createNextWriteStream(): Promise<void> {
        return new Promise(async (resolve) => {
            const createWriteStream = () => {
                this.writeStream = fs.createWriteStream(
                    `${this.outputFilename}_${this.writeSequence}${this.outputFileExt ? `.${this.outputFileExt}` : ""}`
                );
                log.debug(`created new writestream, write sequence ${this.writeSequence}.`);
            };
            if (this.writeStream) {
                this.writeStream.end(() => {
                    createWriteStream();
                    resolve();
                });
            } else {
                createWriteStream();
                resolve();
            }
        });
    }

    private waitStreamWritable(stream: fs.WriteStream): Promise<void> {
        return new Promise((resolve) => {
            stream.once("drain", resolve);
        });
    }

    private async checkWritableTasks() {
        if (this.isCheckingWritableFiles) {
            return;
        }
        this.isCheckingWritableFiles = true;
        log.debug("check writable tasks start.");
        const writableTasks: ConcentrationTask[] = [];
        for (let i = this.lastFinishIndex + 1; i <= this.tasks.length; i++) {
            if (!this.tasks[i] && this.taskStatusRecords[i] === TaskStatus.DROPPED) {
                if (!this.ignoreBreakpoints) {
                    // 文件未下载 但是任务已经被丢弃 忽略空缺 记录文件分割点
                    log.debug(`create new breakpoint at ${i}`);
                    this.breakpoints.push(i);
                }
                continue;
            }
            if (!this.tasks[i]) {
                break;
            }
            writableTasks.push(this.tasks[i]);
            this.taskWriteCount[this.writeSequence]++;
        }
        if (writableTasks.length > 0) {
            await this.writeFiles(writableTasks);
            if (this.deleteAfterWritten) {
                for (const task of writableTasks) {
                    fs.unlinkSync(task.filePath);
                }
            }
        }
        log.debug("check writable tasks end.");
        this.isCheckingWritableFiles = false;
    }

    private writeFiles(tasks: ConcentrationTask[]): Promise<void> {
        this.lastFinishIndex = tasks[tasks.length - 1].index;
        return new Promise(async (resolve) => {
            let writable = true;
            let counter = 0;
            for (const task of tasks) {
                if (this.breakpoints.includes(task.index - 1)) {
                    log.debug(`meet write point at ${task.index}.`);
                    this.writeSequence++;
                    await this.createNextWriteStream();
                }
                writable = this.writeStream.write(fs.readFileSync(task.filePath), () => {
                    counter++;
                    if (counter === tasks.length) {
                        resolve();
                    }
                });
                if (!writable) {
                    // handle back pressure
                    await this.waitStreamWritable(this.writeStream);
                }
            }
        });
    }

    public addTasks(tasks: ConcentrationTask[]) {
        for (const task of tasks) {
            this.tasks[task.index] = task;
        }
        this.checkWritableTasks();
    }

    /**
     * 注意：必须在所有任务添加后调用
     */
    public async waitAllFilesWritten() {
        while (this.isCheckingWritableFiles) {
            await sleep(200);
        }
        await this.checkWritableTasks();
        await this.closeWriteStream();
        if (this.taskWriteCount[this.writeSequence] === 0) {
            // 如果最后一个文件为空，则删除
            fs.unlinkSync(
                `${this.outputFilename}_${this.writeSequence}${this.outputFileExt ? `.${this.outputFileExt}` : ""}`
            );
            this.writeSequence--;
        }
        if (this.writeSequence === 0) {
            // 只输出了一个文件 重命名为原文件名
            fs.renameSync(
                `${this.outputFilename}_${this.writeSequence}${this.outputFileExt ? `.${this.outputFileExt}` : ""}`,
                `${this.outputFilename}${this.outputFileExt ? `.${this.outputFileExt}` : ""}`
            );
        }
    }

    public async closeWriteStream() {
        return new Promise((resolve) => {
            this.writeStream.end(resolve);
        });
    }

    public getOutputFilePaths(): string[] {
        const result = [];
        for (let i = 0; i <= this.writeSequence; i++) {
            result.push(`${this.outputFilename}_${i}${this.outputFileExt ? `.${this.outputFileExt}` : ""}`);
        }
        return result;
    }
}

export default FileConcentrator;
