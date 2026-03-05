import globals from "globals";

export default [
  {
    files: ["**/*.html", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Functions called from HTML onclick attributes appear unused to ESLint
      "no-unused-vars": ["warn", {
        varsIgnorePattern: "^(toggleConnection|disconnect|toggleSection|saveCurrentProfile|exportProfile|importProfile|loadSaved|delSaved|openProfile|closeProfile|openAbout|closeAbout|sendQuery|setFC|togglePolling|clearLog|addProfileEntry|copyFirstToAll|reRender|clearActiveProfile|updateOffsetUI|updateWirePreview)$"
      }],
    },
  },
];
