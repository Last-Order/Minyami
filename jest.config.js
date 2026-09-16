/** @type {import("jest").Config} */
module.exports = {
    clearMocks: true,
    collectCoverageFrom: ["src/**/*.ts", "!src/index.ts"],
    coverageDirectory: "coverage",
    coverageProvider: "v8",
    restoreMocks: true,
    roots: ["<rootDir>/test"],
    testEnvironment: "node",
    testMatch: ["**/*.test.ts"],
    testTimeout: 10000,
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
        // Erii only exports an import entry; resolve it explicitly for the CommonJS test runner.
        "^erii$": "<rootDir>/node_modules/erii/dist/index.mjs",
    },
    transform: {
        "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }],
        // Tests remain CommonJS, so ESM-only dependencies must cross that boundary through ts-jest.
        "^.+\\.m?js$": [
            "ts-jest",
            {
                diagnostics: false,
                tsconfig: {
                    allowJs: true,
                    esModuleInterop: true,
                    module: "commonjs",
                    target: "es2022",
                },
            },
        ],
    },
    transformIgnorePatterns: [
        "/node_modules/(?!https-proxy-agent|socks-proxy-agent|agent-base|proxy-agent-negotiate|erii|chalk)/",
    ],
};
