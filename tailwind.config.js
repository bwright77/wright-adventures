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
          // Text-safe cyan. The brand #009DD6 measures 2.8–3.1:1 as small text
          // on our light backgrounds, well under the 4.5:1 AA needs. This is the
          // same hue darkened until it clears 4.5:1 on white, river-50, navy-50,
          // gray-50 and the cream (worst case 4.68:1). Use it for small text on
          // light; keep DEFAULT for text on navy and for fills.
          700: '#00749E',
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
          // 4.38:1 on trail-50 — just under AA for small text.
          700: '#477755',
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
