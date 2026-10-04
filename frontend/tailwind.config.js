/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 亮色主题（默认）
        bg: {
          primary: 'rgba(var(--bg-primary-rgb), 1)',
          secondary: 'rgba(var(--bg-secondary-rgb), 1)',
          tertiary: 'rgba(var(--bg-tertiary-rgb), 1)',
        },
        text: {
          primary: 'rgba(var(--text-primary-rgb), 1)',
          secondary: 'rgba(var(--text-secondary-rgb), 1)',
          tertiary: 'rgba(var(--text-tertiary-rgb), 1)',
        },
        accent: {
          DEFAULT: 'rgba(var(--accent-rgb), 1)',
          hover: 'rgba(var(--accent-hover-rgb), 1)',
        },
        border: 'rgba(var(--border-rgb), 1)',
      },
      transitionTimingFunction: {
        // 动效曲线（HIG 分工，见 index.css 的 --ease-*）：不是一条通吃。
        // ui    微交互（hover / 变色 / 焦点）：克制、几乎察觉不到
        // enter 进场浮现：减速落定（decelerate）
        // exit  退场：加速离开（accelerate），不拖尾巴
        // move  位移 / 尺寸 / 翻页：长距离，柔和收尾（单张元素进场）
        // swap  推卡：两张同向移动、两端都在静止，用对称 S 曲线
        //       = UIKit 的 curveEaseInOut（begin slowly, accelerate through the middle, slow again）
        // soft  透明度 / 颜色交叉溶解：慢起手 + 长收尾（没有运动遮挡，快起手就是啪一下）
        // spring 回弹强调（猫）
        DEFAULT: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        ui: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
        exit: 'cubic-bezier(0.4, 0, 1, 1)',
        move: 'cubic-bezier(0.22, 1, 0.36, 1)',
        swap: 'cubic-bezier(0.42, 0, 0.58, 1)',
        soft: 'cubic-bezier(0.45, 0, 0.25, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"SF Mono"', 'Monaco', 'Cascadia Code', 'Roboto Mono', 'monospace'],
      },
      borderRadius: {
        'md3-sm': '8px',
        'md3': '12px',
        'md3-lg': '16px',
        'md3-xl': '20px',
        'md3-2xl': '24px',
      },
      boxShadow: {
        'md3': '0 1px 3px rgba(0, 0, 0, 0.06)',
        'md3-lg': '0 4px 12px rgba(0, 0, 0, 0.08)',
        'md3-xl': '0 8px 24px rgba(0, 0, 0, 0.12)',
      },
      keyframes: {
        shimmer: {
          '100%': {
            transform: 'translateX(100%)',
          },
        },
      },
      animation: {
        shimmer: 'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
}