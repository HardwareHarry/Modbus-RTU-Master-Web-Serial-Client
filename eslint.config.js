import html from "eslint-plugin-html";
import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        files: ["**/*.html"],
        plugins: {
            html
        },
        languageOptions: {
            globals: {
                window: "readonly",
                document: "readonly",
                console: "readonly"
            },
            ecmaVersion: "latest",
            sourceType: "module"
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "error"
        }
    }
];