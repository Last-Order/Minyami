import { jest } from "@jest/globals";

// Keep parsing real; Erii tests terminal rendering in its native ESM suite.
jest.mock("ink", () => ({ Box: "ink-box", Text: "ink-text", renderToString: () => "Help:" }));
