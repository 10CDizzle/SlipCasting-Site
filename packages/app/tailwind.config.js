/**
 * The Onshape palette, per UI-UX.md: a dark workspace that recedes so the
 * graphics area is the brightest thing on screen. CAD is looked at for hours;
 * every panel here is deliberately quieter than the model it surrounds.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Chrome, darkest to lightest.
        shell: {
          900: '#101216', // app background, behind everything
          800: '#171a1f', // panels
          700: '#1e2229', // raised rows, toolbar
          600: '#282d36', // borders, dividers
          500: '#39404b', // hover
          400: '#5b6675', // disabled text
        },
        ink: {
          100: '#e8ecf1', // primary text
          300: '#a7b0bd', // secondary text
          500: '#6d7785', // tertiary
        },
        // Onshape's selection blue: the field waiting for a viewport pick.
        pick: {
          DEFAULT: '#2f81f7',
          soft: 'rgba(47, 129, 247, 0.16)',
        },
        // The draft heatmap. These three must stay legible to a red-green
        // colour-blind user: "your part cannot be molded" is not a message
        // anyone should be able to miss.
        draft: {
          ok: '#6bc785',
          shallow: '#f2b53f',
          undercut: '#b82938',
        },
        danger: '#e5484d',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // CAD chrome runs small; the model is the content.
        xs: ['11px', '15px'],
        sm: ['12px', '17px'],
        base: ['13px', '19px'],
      },
    },
  },
  plugins: [],
};
