const tseslint = require("typescript-eslint");

module.exports = {
  languageOptions: {
    globals: {
      node: true,
    },
    parser: tseslint.parser,
    parserOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
    },
  },
  plugins: {
    "@typescript-eslint": tseslint.plugin,
  },
  rules: {
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-explicit-any": "warn",
  },
};
