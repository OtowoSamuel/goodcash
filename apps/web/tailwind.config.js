/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#7b39fc',
          hover: '#8c4eff',
          light: '#a484d7',
          glow: 'rgba(123, 57, 252, 0.4)',
        },
        dark: {
          purple: '#2b2344',
          surface: '#151024',
          subtle: '#201a33',
          border: 'rgba(164, 132, 215, 0.25)',
        },
      },
      fontFamily: {
        manrope: ['Manrope', 'sans-serif'],
        cabin: ['Cabin', 'sans-serif'],
        serif: ['"Instrument Serif"', 'serif'],
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
