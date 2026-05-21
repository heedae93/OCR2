/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary brand color
        'primary': '#2563EB',
        'primary-light': '#3B82F6',
        'primary-dark': '#1D4ED8',

        // Light mode - one tone darker (muted)
        'background-light': '#E8EDF4',
        'surface-light': '#F2F5FA',
        'surface-alt-light': '#EBF0F7',
        'border-light': '#CBD5E1',
        'text-primary-light': '#1A202C',
        'text-secondary-light': '#64748B',

        // Dark mode - mapped to muted light (toggle has no visual effect on content)
        'background-dark': '#E8EDF4',
        'surface-dark': '#F2F5FA',
        'surface-alt-dark': '#EBF0F7',
        'border-dark': '#CBD5E1',
        'text-primary-dark': '#1A202C',
        'text-secondary-dark': '#64748B',

        // Accent colors
        'accent-blue': '#3B82F6',
        'accent-green': '#10B981',
        'accent-orange': '#F59E0B',
        'accent-red': '#EF4444',
        'accent-purple': '#8B5CF6',

        // Metadata field badge colors
        'metadata-title-bg': '#F1F5F9',
        'metadata-title-text': '#334155',
        'metadata-title-ring': '#CBD5E1',
        'metadata-date-bg': '#ECFDF5',
        'metadata-date-text': '#047857',
        'metadata-date-ring': '#A7F3D0',
        'metadata-amount-bg': '#F5F3FF',
        'metadata-amount-text': '#6D28D9',
        'metadata-amount-ring': '#DDD6FE',
        'metadata-vendor-bg': '#FFF7ED',
        'metadata-vendor-text': '#C2410C',
        'metadata-vendor-ring': '#FED7AA',
        'metadata-address-bg': '#F5F5F4',
        'metadata-address-text': '#57534E',
        'metadata-address-ring': '#D6D3D1',
        'metadata-person-bg': '#F0FDFA',
        'metadata-person-text': '#0F766E',
        'metadata-person-ring': '#99F6E4',
        'metadata-custom-bg': '#F0F9FF',
        'metadata-custom-text': '#0369A1',
        'metadata-custom-ring': '#BAE6FD',
      },
      fontFamily: {
        'display': ['Inter', 'Noto Sans KR', 'sans-serif'],
      },
      borderRadius: {
        'DEFAULT': '0.5rem',
        'lg': '0.75rem',
        'xl': '1rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        'soft': '0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 10px 20px -2px rgba(0, 0, 0, 0.04)',
        'soft-lg': '0 10px 40px -10px rgba(0, 0, 0, 0.1), 0 20px 25px -5px rgba(0, 0, 0, 0.05)',
        'glow': '0 0 20px rgba(37, 99, 235, 0.3)',
        'glow-lg': '0 0 40px rgba(37, 99, 235, 0.4)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-light': 'linear-gradient(135deg, #F0F4F8 0%, #E2E8F0 100%)',
        'gradient-dark': 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
      },
      keyframes: {
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 0.25s ease-out',
      },
    },
  },
  plugins: [],
}
