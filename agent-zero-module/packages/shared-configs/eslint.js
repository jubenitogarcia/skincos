module.exports = {
  extends: [
    "eslint:recommended",
    "@typescript-eslint/recommended",
    "prettier"
  ],
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module"
  },
  rules: {
    // Common rules for the monorepo
    "no-console": "warn",
    "no-debugger": "error",
    "prefer-const": "error",
    "no-unused-vars": "off", // Use TypeScript version instead
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-explicit-any": "warn"
  },
  overrides: [
    {
      files: ["*.test.js", "*.test.ts", "*.spec.js", "*.spec.ts"],
      env: {
        jest: true
      },
      rules: {
        "no-console": "off"
      }
    }
  ]
};