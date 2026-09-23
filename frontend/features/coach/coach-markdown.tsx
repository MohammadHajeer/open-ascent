import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function CoachMarkdown({ content }: { content: string }) {
  return (
    <div className="min-w-0 space-y-3 break-words text-[15px] leading-[1.7] text-foreground-soft [&_strong]:font-semibold [&_strong]:text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: ({ children }) => <h2 className="pt-1 text-lg font-semibold tracking-tight text-foreground">{children}</h2>,
          h2: ({ children }) => <h2 className="pt-1 text-lg font-semibold tracking-tight text-foreground">{children}</h2>,
          h3: ({ children }) => <h3 className="pt-1 text-[15px] font-semibold text-foreground">{children}</h3>,
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-primary">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-primary">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-primary/50 pl-4 text-foreground-soft">{children}</blockquote>,
          code: ({ children, className }) => <code className={`rounded bg-muted px-1 py-0.5 font-mono text-[0.82em] text-foreground ${className ?? ""}`}>{children}</code>,
          pre: ({ children }) => <pre className="coach-scroll my-3 max-w-full overflow-x-auto rounded-lg border border-border bg-background-alt p-3 text-sm">{children}</pre>,
          table: ({ children }) => <div className="coach-scroll my-4 max-w-full overflow-x-auto rounded-md border border-border/75"><table className="w-full min-w-max border-collapse text-left text-xs leading-5">{children}</table></div>,
          th: ({ children }) => <th className="border-b border-border bg-background-alt/70 px-3 py-2 font-semibold text-foreground">{children}</th>,
          td: ({ children }) => <td className="border-b border-border/60 px-3 py-2 align-top last:border-b-0">{children}</td>,
          a: ({ children, href }) => <a href={href} className="text-primary underline underline-offset-2">{children}</a>,
        }}
      >{content}</ReactMarkdown>
    </div>
  );
}
