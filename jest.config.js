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
    transform: {
        "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }],
    },
};
