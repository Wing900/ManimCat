import { memo, useEffect, useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'

interface StudioMarkdownProps {
  content: string
  className?: string
  showCaret?: boolean
}

export const StudioMarkdown = memo(function StudioMarkdown({
  content,
  className = '',
  showCaret = false,
}: StudioMarkdownProps) {
  const [isDark, setIsDark] = useState(
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const updateThemeState = () => {
      setIsDark(document.documentElement.classList.contains('dark'))
    }

    updateThemeState()

    const observer = new MutationObserver(updateThemeState)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => observer.disconnect()
  }, [])

  const components = createMarkdownComponents(isDark)

  return (
    <div className={`studio-markdown ${className}`.trim()}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { output: 'htmlAndMathml', strict: 'ignore', trust: false }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
      {showCaret && <span className="studio-type-caret opacity-30">█</span>}
    </div>
  )
})

function createMarkdownComponents(isDark: boolean): Components {
  return {
    a: ({ node: _node, ...props }) => (
      <a
        {...props}
        className="text-accent underline decoration-border/30 underline-offset-4 transition hover:text-accent-hover"
        rel="noreferrer"
        target="_blank"
      />
    ),
    blockquote: ({ node: _node, className, ...props }) => (
      <blockquote
        {...props}
        className={['border-l-2 border-border/10 pl-4 text-text-secondary/80', className].filter(Boolean).join(' ')}
      />
    ),
    code: ({ node: _node, className, children, ...props }) => {
      const languageMatch = /language-([\w-]+)/.exec(className ?? '')
      const code = String(children).replace(/\n$/, '')

      if (!languageMatch) {
        return (
          <code
            {...props}
            className="rounded-md bg-black/6 px-1.5 py-0.5 font-mono text-[0.92em] text-text-primary/90 dark:bg-white/10"
          >
            {children}
          </code>
        )
      }

      return (
        <SyntaxHighlighter
          language={languageMatch[1]}
          style={isDark ? vscDarkPlus : oneLight}
          wrapLongLines
          customStyle={{
            margin: 0,
            padding: '1rem 1.1rem',
            borderRadius: '1rem',
            fontSize: '0.86rem',
            lineHeight: '1.65',
            background: 'rgba(15, 23, 42, 0.06)',
            fontFamily: 'Monaco, Cascadia Code, Roboto Mono, monospace',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'Monaco, Cascadia Code, Roboto Mono, monospace',
            },
          }}
        >
          {code}
        </SyntaxHighlighter>
      )
    },
    hr: ({ node: _node, ...props }) => <hr {...props} className="border-0 border-t border-border/10" />,
    img: ({ node: _node, alt, ...props }) => (
      <img
        {...props}
        alt={alt ?? ''}
        className="max-h-[22rem] rounded-2xl border border-border/10 object-contain"
        loading="lazy"
      />
    ),
    pre: ({ node: _node, children }) => <div className="overflow-x-auto">{children}</div>,
    table: ({ node: _node, ...props }) => (
      <div className="overflow-x-auto">
        <table {...props} className="min-w-full border-collapse text-left text-[0.95em]" />
      </div>
    ),
    td: ({ node: _node, className, ...props }) => (
      <td {...props} className={['border border-border/10 px-3 py-2 align-top', className].filter(Boolean).join(' ')} />
    ),
    th: ({ node: _node, className, ...props }) => (
      <th
        {...props}
        className={[
          'border border-border/10 bg-black/5 px-3 py-2 font-semibold text-text-primary/90 dark:bg-white/5',
          className,
        ].filter(Boolean).join(' ')}
      />
    ),
  }
}
