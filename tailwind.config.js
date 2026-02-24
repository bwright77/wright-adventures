/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#004667',
          dark: '#003350',
          light: '#E8F4FA',
          900: '#002035',
          800: '#003350',
          700: '#004667',
          50: '#E8F4FA',
        },
        river: {
          DEFAULT: '#009DD6',
          light: '#F0F9FF',
          50: '#F0F9FF',
        },
        earth: {
          DEFAULT: '#B44B00',
          light: '#FFF3EB',
          hover: '#C95600',
          50: '#FFF3EB',
        },
        trail: {
          DEFAULT: '#4A7C59',
          light: '#EDF5F0',
          50: '#EDF5F0',
        },
        warm: {
          gray: '#F5F3F0',
        },
      },
      fontFamily: {
        jost: ['Jost', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.6s ease-out forwards',
        'pulse-dot': 'pulseDot 2s ease infinite',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
    },
  },
  plugins: [],
}
