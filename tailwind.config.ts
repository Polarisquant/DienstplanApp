import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        rota: {
          header: "#4472C4",
          rail: "#D9D9D9",
          border: "#404040",
        },
      },
    },
  },
  plugins: [],
};

export default config;
