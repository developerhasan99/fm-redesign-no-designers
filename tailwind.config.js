/** @type {import('tailwindcss').Config} */
module.exports = {
  // Everything that can carry a class name: Liquid, custom-liquid settings stored in JSON, and theme JS that
  // adds classes at runtime. Vendor bundles are skipped.
  content: [
    "./layout/*.liquid",
    "./sections/*.{liquid,json}",
    "./snippets/*.liquid",
    "./blocks/*.liquid",
    "./templates/**/*.{liquid,json}",
    "./config/settings_data.json",
    "./assets/*.js",
    "!./assets/*.min.js",
  ],
  theme: {
    extend: {
      fontFamily: {
        recoleta: ["Recoleta", "serif"],
        circle: ["CircularStd", "sans-serif"],
      },
      colors: {
        blackPurple: "#2a2447",
        darkPurple: "#6A2786",
        purple: "#9151B7",
        litePurple: "#E8D7EF",
        purpleCream: "#f9f4fb",
        saffron: "#e64a4a",
      },
    },
  },
  plugins: [],
};
