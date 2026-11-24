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
        tinta: { DEFAULT: '#16252D', 900: '#0C171D', 800: '#122027', 700: '#22343E', 600: '#334852', 500: '#4E636D', 400: '#6B7F88', 300: '#9AABB2', 200: '#C3CED2' },
        papel: { DEFAULT: '#F3F5F2', 50: '#FAFBF9', 100: '#EEF1ED', 200: '#E6EAE5', 300: '#D5DBD4', 400: '#BCC5BB' },
        noite: { DEFAULT: '#0F181D', 900: '#0A1115', 800: '#16232A', 700: '#1F2E36', 600: '#2B3D46', 500: '#3A4F59' },
        caixa: { 50: '#E6F4F1', 100: '#C8E8E1', 200: '#9AD6CA', 300: '#5CC3AF', 400: '#2FAA94', 500: '#14917D', 600: '#0E7C6B', 700: '#0A6457', 800: '#084E44', 900: '#063A33' },
        ambar: { 50: '#FDF3E6', 100: '#FBE3C2', 300: '#F0B45E', 500: '#DE8418', 600: '#C26A0A', 700: '#98520A' },
        rubro: { 50: '#FCECEA', 100: '#F8D3CF', 300: '#F08A80', 500: '#D4392C', 600: '#B42318', 700: '#8E1B13' },
        // compatibilidade com classes antigas
        marca: { 50: '#E6F4F1', 100: '#C8E8E1', 500: '#14917D', 600: '#0E7C6B', 700: '#0A6457' },
      },
      boxShadow: {
        cupom: '0 1px 0 rgba(22,37,45,.06), 0 8px 24px -12px rgba(22,37,45,.25)',
        cartao: '0 1px 2px rgba(22,37,45,.06), 0 0 0 1px rgba(22,37,45,.05)',
        elevado: '0 2px 4px rgba(22,37,45,.06), 0 12px 32px -8px rgba(22,37,45,.22)',
        janela: '0 24px 64px -12px rgba(8,20,26,.45), 0 0 0 1px rgba(22,37,45,.06)',
        botao: '0 1px 0 rgba(255,255,255,.18) inset, 0 1px 2px rgba(10,100,87,.35)',
      },
      keyframes: {
        surgir: { from: { opacity: '0', transform: 'translateY(8px) scale(.985)' }, to: { opacity: '1', transform: 'none' } },
        esmaecer: { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        surgir: 'surgir .18s cubic-bezier(.2,.8,.2,1)',
        esmaecer: 'esmaecer .15s ease-out',
      },
    },
  },
  plugins: [],
}
