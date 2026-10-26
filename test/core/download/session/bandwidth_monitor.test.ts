import { describe, expect, test } from "@jest/globals";
import { BandwidthMonitor } from "@/core/download/session/bandwidth_monitor";

describe("BandwidthMonitor", () => {
    test("aggregates completed chunks using elapsed time during startup", () => {
        let now = 0;
        const monitor = new BandwidthMonitor(() => now);
        monitor.start();
        expect(monitor.bytesPerSecond()).toBe(0);

        now = 1_000;
        monitor.recordChunk({ bytes: 125_000, startedAt: 0, completedAt: now });
        monitor.recordChunk({ bytes: 250_000, startedAt: 0, completedAt: now });
        expect(monitor.bytesPerSecond()).toBe(375_000);

        now = 2_000;
        expect(monitor.bytesPerSecond()).toBe(187_500);
    });

    test("expires completed chunks from its five-second window and decays to zero while idle", () => {
        let now = 0;
        const monitor = new BandwidthMonitor(() => now);
        monitor.start();
        now = 1_000;
        monitor.recordChunk({ bytes: 5_000_000, startedAt: 0, completedAt: now });
        now = 5_000;
        monitor.recordChunk({ bytes: 625_000, startedAt: 4_000, completedAt: now });

        now = 6_000;
        expect(monitor.bytesPerSecond()).toBe(125_000);
        now = 10_000;
        expect(monitor.bytesPerSecond()).toBe(0);
    });

    test("starts a fresh measurement without retaining earlier traffic or idle time", () => {
        let now = 0;
        const monitor = new BandwidthMonitor(() => now);
        monitor.start();
        now = 1_000;
        monitor.recordChunk({ bytes: 5_000_000, startedAt: 0, completedAt: now });
        now = 60_000;
        monitor.start();

        now = 61_000;
        monitor.recordChunk({ bytes: 125_000, startedAt: 60_000, completedAt: now });
        expect(monitor.bytesPerSecond()).toBe(125_000);
    });

    test("keeps the rate finite when a chunk completes in the same clock tick as startup", () => {
        const monitor = new BandwidthMonitor(() => 0);
        monitor.start();
        monitor.recordChunk({ bytes: 125, startedAt: 0, completedAt: 0 });

        expect(monitor.bytesPerSecond()).toBe(125_000);
    });

    test("spreads a long chunk over its actual download interval and decays after completion", () => {
        let now = 0;
        const monitor = new BandwidthMonitor(() => now);
        monitor.start();
        now = 20_000;
        monitor.recordChunk({ bytes: 10_000_000, startedAt: 0, completedAt: now });

        expect(monitor.bytesPerSecond()).toBe(500_000);
        now = 22_000;
        expect(monitor.bytesPerSecond()).toBe(300_000);
        now = 25_000;
        expect(monitor.bytesPerSecond()).toBe(0);
    });

    test("aggregates overlapping downloads without summing their elapsed time", () => {
        let now = 0;
        const monitor = new BandwidthMonitor(() => now);
        monitor.start();
        now = 20_000;
        monitor.recordChunk({ bytes: 10_000_000, startedAt: 0, completedAt: now });
        monitor.recordChunk({ bytes: 5_000_000, startedAt: 15_000, completedAt: now });

        expect(monitor.bytesPerSecond()).toBe(1_500_000);
    });

    test("keeps decryption delays out of the transfer window", () => {
        let now = 0;
        const monitor = new BandwidthMonitor(() => now);
        monitor.start();
        now = 10_000;
        monitor.recordChunk({ bytes: 1_000_000, startedAt: 0, completedAt: 1_000 });

        expect(monitor.bytesPerSecond()).toBe(0);
    });
});
