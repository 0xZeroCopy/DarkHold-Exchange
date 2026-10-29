/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        themeBg: '#a5a79b',
        themeWine: '#590907',
        themeWineDark: '#430605',
        themeWineHover: '#4d0806',
        themeCream: '#ebd2b5',
      },
    },
  },
  plugins: [],
};