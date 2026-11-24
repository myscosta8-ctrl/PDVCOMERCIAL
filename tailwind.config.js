/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Barlow', 'system-ui', 'sans-serif'],
        numero: ['"Barlow Semi Condensed"', 'Barlow', 'sans-serif'],
      },
      colors: {
        // Paleta: tinta de cupom, papel de bobina, verde-caixa para dinheiro/confirmação
        tinta: { DEFAULT: '#16252D', 700: '#22343E', 600: '#334852', 400: '#6B7F88', 300: '#9AABB2' },
        papel: { DEFAULT: '#F3F5F2', 200: '#E6EAE5', 300: '#D5DBD4' },
        noite: { DEFAULT: '#0F181D', 800: '#16232A', 700: '#1F2E36', 600: '#2B3D46' },
        caixa: { 50: '#E6F4F1', 100: '#C8E8E1', 500: '#14917D', 600: '#0E7C6B', 700: '#0A6457', 300: '#5CC3AF' },
        ambar: { 50: '#FDF3E6', 600: '#C26A0A', 300: '#F0B45E' },
        rubro: { 50: '#FCECEA', 600: '#B42318', 300: '#F08A80' },
        // compatibilidade com classes antigas
        marca: { 50: '#E6F4F1', 100: '#C8E8E1', 500: '#14917D', 600: '#0E7C6B', 700: '#0A6457' },
      },
      boxShadow: { cupom: '0 1px 0 rgba(22,37,45,.06), 0 8px 24px -12px rgba(22,37,45,.25)' },
    },
  },
  plugins: [],
}
