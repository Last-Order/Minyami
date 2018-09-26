"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const log_1 = require("../utils/log");
let Log = log_1.default.getInstance();
/**
 * Get previous task
 * @param taskId
 */
function getTask(taskId) {
    const taskFilePath = path.resolve(__dirname, '../../tasks.json');
    if (!fs.existsSync(taskFilePath)) {
        return;
    }
    const taskFileContent = fs.readFileSync(taskFilePath).toString();
    try {
        const previousTasks = JSON.parse(taskFileContent);
        const index = previousTasks.findIndex(t => {
            return t.id === taskId;
        });
        if (index === -1) {
            return;
        }
        return previousTasks[index];
    }
    catch (e) {
        return;
    }
}
exports.getTask = getTask;
/**
 * Save(add) or update task
 * @param task
 */
function saveTask(task) {
    const taskFilePath = path.resolve(__dirname, '../../tasks.json');
    const tasks = [];
    if (fs.existsSync(taskFilePath)) {
        const taskFileContent = fs.readFileSync(taskFilePath).toString();
        try {
            const previousTasks = JSON.parse(taskFileContent);
            tasks.push(...previousTasks);
        }
        catch (e) {
            Log.error('Fail to parse previous tasks, ignored.');
        }
    }
    const index = tasks.findIndex(t => t.id === task.id);
    if (index !== -1) {
        // Update previous task
        tasks[index] = task;
    }
    else {
        tasks.push(task);
    }
    // Write back to file
    fs.writeFileSync(taskFilePath, JSON.stringify(tasks, null, 2));
}
exports.saveTask = saveTask;
/**
 * Delete task
 * @param taskId
 */
function deleteTask(taskId) {
    const taskFilePath = path.resolve(__dirname, '../../tasks.json');
    const tasks = [];
    if (!fs.existsSync(taskFilePath)) {
        // No previous tasks. No task to delete.
        return false;
    }
    const taskFileContent = fs.readFileSync(taskFilePath).toString();
    try {
        const previousTasks = JSON.parse(taskFileContent);
        tasks.push(...previousTasks);
    }
    catch (e) {
        Log.error('Fail to parse previous tasks, ignored.');
    }
    const index = tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
        return false;
    }
    else {
        // Write back to file
        fs.writeFileSync(taskFilePath, JSON.stringify(tasks.filter(t => t.id !== taskId), null, 2));
    }
}
exports.deleteTask = deleteTask;
//# sourceMappingURL=task.js.map