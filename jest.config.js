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
    },
    transform: {
        "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }],
        // Tests remain CommonJS, so the ESM-only proxy stack must cross that boundary through ts-jest.
        "^.+\\.js$": [
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
        "/node_modules/(?!https-proxy-agent|socks-proxy-agent|agent-base|proxy-agent-negotiate)/",
    ],
};
