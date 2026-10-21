/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/test"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transformIgnorePatterns: ["/node_modules/(?!jose/)"],
  transform: {
    "node_modules/jose/.+\\.js$":
      "<rootDir>/test/helpers/jose-jest-transform.cjs",
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  testMatch: ["**/test/**/*.test.ts", "**/test/**/*.spec.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverage: false,
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/cdk.out/"],
  setupFiles: ["<rootDir>/jest.setup.ts"],
};
