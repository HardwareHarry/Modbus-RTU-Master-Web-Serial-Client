import html from "eslint-plugin-html";

export default [
  {
    files: ["**/*.html"],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        // Browser environment
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        console: "readonly",
        alert: "readonly",
        confirm: "readonly",
        prompt: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        performance: "readonly",
        URL: "readonly",
        Blob: "readonly",
        File: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        Event: "readonly",
        CustomEvent: "readonly",
        HTMLElement: "readonly",
        ArrayBuffer: "readonly",
        DataView: "readonly",
        Uint8Array: "readonly",
        BigInt: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", {
        varsIgnorePattern: "^(toggleConnection|disconnect|toggleSection|saveCurrentProfile|exportProfile|importProfile|loadSaved|delSaved|openProfile|closeProfile|openAbout|closeAbout|sendQuery|setFC|togglePolling|clearLog|addProfileEntry|copyFirstToAll|reRender|clearActiveProfile|updateOffsetUI|updateWirePreview)$"
      }],
    },
  },
];
